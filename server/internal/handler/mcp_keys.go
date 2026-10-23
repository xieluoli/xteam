package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/auth"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type mcpPrincipal struct {
	Key db.McpKey
}
type MCPKeyResponse struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	WorkspaceID string   `json:"workspace_id"`
	Scopes      []string `json:"scopes"`
	TokenPrefix string   `json:"token_prefix"`
	ExpiresAt   string   `json:"expires_at"`
	LastUsedAt  *string  `json:"last_used_at"`
	CreatedAt   string   `json:"created_at"`
}

func mcpKeyResponse(key db.McpKey) MCPKeyResponse {
	return MCPKeyResponse{
		ID: uuidToString(key.ID), Name: key.Name, WorkspaceID: uuidToString(key.WorkspaceID),
		Scopes: key.Scopes, TokenPrefix: key.TokenPrefix,
		ExpiresAt: timestampToString(key.ExpiresAt), LastUsedAt: timestampToPtr(key.LastUsedAt),
		CreatedAt: timestampToString(key.CreatedAt),
	}
}
func (h *Handler) CreateMCPKey(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUserID(w, r)
	if !ok {
		return
	}
	var input struct {
		Name          string   `json:"name"`
		WorkspaceID   string   `json:"workspace_id"`
		Scopes        []string `json:"scopes"`
		ExpiresInDays int      `json:"expires_in_days"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil {
		writeError(w, http.StatusBadRequest, "invalid MCP key request")
		return
	}
	if decoder.Decode(new(any)) != io.EOF {
		writeError(w, http.StatusBadRequest, "expected one MCP key request")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 200 {
		writeError(w, http.StatusBadRequest, "name is required (max 200 bytes)")
		return
	}
	workspace, ok := parseUUIDOrBadRequest(w, input.WorkspaceID, "workspace_id")
	if !ok {
		return
	}
	if _, ok := h.requireWorkspaceMember(w, r, input.WorkspaceID, "workspace not found"); !ok {
		return
	}
	if input.ExpiresInDays == 0 {
		input.ExpiresInDays = 90
	}
	if input.ExpiresInDays < 1 || input.ExpiresInDays > 90 {
		writeError(w, http.StatusBadRequest, "MCP keys expire within 1 to 90 days")
		return
	}
	scopes := []string{}
	seen := map[string]bool{}
	for _, scope := range input.Scopes {
		if scope != "issues:read" && scope != "issues:write" && scope != "issues:delete" {
			writeError(w, http.StatusBadRequest, "unknown MCP key scope")
			return
		}
		if !seen[scope] {
			scopes = append(scopes, scope)
			seen[scope] = true
		}
	}
	if !seen["issues:read"] {
		writeError(w, http.StatusBadRequest, "issues:read is required")
		return
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create key")
		return
	}
	token := "xtm_" + hex.EncodeToString(secret)
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create MCP key")
		return
	}
	defer tx.Rollback(r.Context())
	queries := h.Queries.WithTx(tx)
	if _, err := queries.LockWorkspaceForChatSessionCreate(r.Context(), workspace); err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	if _, err := queries.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{WorkspaceID: workspace, UserID: parseUUID(user)}); err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	key, err := queries.CreateMCPKey(r.Context(), db.CreateMCPKeyParams{UserID: parseUUID(user), WorkspaceID: workspace, Name: input.Name, TokenHash: auth.HashToken(token), TokenPrefix: token[:12], Scopes: scopes, ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Duration(input.ExpiresInDays) * 24 * time.Hour), Valid: true}})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create MCP key")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create MCP key")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, struct {
		MCPKeyResponse
		Token string `json:"token"`
	}{mcpKeyResponse(key), token})
}
func (h *Handler) ListMCPKeys(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUserID(w, r)
	if !ok {
		return
	}
	keys, err := h.Queries.ListMCPKeys(r.Context(), parseUUID(user))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list MCP keys")
		return
	}
	response := make([]MCPKeyResponse, 0, len(keys))
	for _, key := range keys {
		response = append(response, mcpKeyResponse(key))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}
func (h *Handler) RevokeMCPKey(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUserID(w, r)
	if !ok {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "key_id")
	if !ok {
		return
	}
	count, err := h.Queries.RevokeMCPKey(r.Context(), db.RevokeMCPKeyParams{ID: id, UserID: parseUUID(user)})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to revoke MCP key")
		return
	}
	if count == 0 {
		writeError(w, http.StatusNotFound, "key not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *Handler) authenticateMCP(r *http.Request) (mcpPrincipal, bool) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer xtm_") {
		return mcpPrincipal{}, false
	}
	key, err := h.Queries.GetMCPKeyByHash(r.Context(), auth.HashToken(strings.TrimPrefix(header, "Bearer ")))
	if err != nil {
		return mcpPrincipal{}, false
	}
	_, err = h.getWorkspaceMember(r.Context(), uuidToString(key.UserID), uuidToString(key.WorkspaceID))
	if err != nil {
		return mcpPrincipal{}, false
	}
	user, err := h.Queries.GetUser(r.Context(), key.UserID)
	if err != nil {
		return mcpPrincipal{}, false
	}
	if auth.IsTemporarilyDisabledUser(uuidToString(key.UserID), user.Email) {
		return mcpPrincipal{}, false
	}
	return mcpPrincipal{Key: key}, true
}
