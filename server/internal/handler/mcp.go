package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/multica-ai/multica/server/internal/auth"
	"github.com/multica-ai/multica/server/internal/service"
)

type mcpCreateRequestKey struct{}

func mcpIssueRequestFromContext(ctx context.Context) *service.IssueRequestIdentity {
	identity, _ := ctx.Value(mcpCreateRequestKey{}).(*service.IssueRequestIdentity)
	return identity
}
func (h *Handler) ServeMCP(w http.ResponseWriter, r *http.Request) {
	principal, ok := h.authenticateMCP(r)
	if !ok {
		w.Header().Set("WWW-Authenticate", `Bearer realm="xteam-mcp"`)
		writeError(w, http.StatusUnauthorized, "invalid, expired or revoked MCP key")
		return
	}
	// Same origin browser requests are supported; reject cross-origin browser use.
	if origin := r.Header.Get("Origin"); origin != "" {
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Host != r.Host {
			writeError(w, http.StatusForbidden, "cross-origin MCP requests are not allowed")
			return
		}
	}
	_ = h.Queries.TouchMCPKey(r.Context(), principal.Key.ID)
	server := mcp.NewServer(&mcp.Implementation{Name: "xteam", Version: "1"}, nil)
	for _, name := range []string{"xteam_identity", "xteam_issue_list", "xteam_issue_search", "xteam_issue_get", "xteam_issue_create", "xteam_issue_update", "xteam_issue_delete"} {
		schema := mcpToolSchema(name)
		readOnly := name != "xteam_issue_create" && name != "xteam_issue_update" && name != "xteam_issue_delete"
		tool := &mcp.Tool{
			Name: name, Description: mcpToolDescription(name), InputSchema: schema,
			Annotations: &mcp.ToolAnnotations{
				ReadOnlyHint:    readOnly,
				DestructiveHint: boolPointer(name == "xteam_issue_delete" || name == "xteam_issue_update"),
				IdempotentHint:  name == "xteam_issue_create",
			},
		}
		mcp.AddTool(server, tool, func(ctx context.Context, req *mcp.CallToolRequest, args map[string]any) (*mcp.CallToolResult, any, error) {
			arguments, _ := json.Marshal(args)
			output, err := h.callMCPTool(ctx, principal, req.Params.Name, arguments)
			slog.InfoContext(ctx, "MCP tool call", "key_id", uuidToString(principal.Key.ID), "user_id", uuidToString(principal.Key.UserID), "workspace_id", uuidToString(principal.Key.WorkspaceID), "tool", req.Params.Name, "success", err == nil)
			if err != nil {
				return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}}}, nil, nil
			}
			encoded, _ := json.Marshal(output)
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(encoded)}}}, nil, nil
		})
	}
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true, MaxRequestBodyBytes: 128 << 10})
	handler.ServeHTTP(w, r)
}
func boolPointer(value bool) *bool { return &value }
func mcpToolDescription(name string) string {
	switch name {
	case "xteam_identity":
		return "Read the authenticated XTeam user, bound workspace and scopes. No arguments."
	case "xteam_issue_list":
		return "List issues. Optional limit (1-50), offset, status, project_id."
	case "xteam_issue_search":
		return "Search issues. Required query; optional limit (1-50), offset."
	case "xteam_issue_get":
		return "Get issue by id (UUID or readable issue identifier)."
	case "xteam_issue_create":
		return "Create unassigned issue. Required request_id (stable across retries) and title; optional description,status,priority,project_id,start_date,due_date. No execution or assignment."
	case "xteam_issue_update":
		return "Update issue: id plus changes object containing title,description,status,priority,project_id,start_date,due_date. Does not start assigned agents."
	case "xteam_issue_delete":
		return "Destructive: delete issue and its normal dependents after explicit user authorization. Requires id and confirmed=true. Never infer human consent from this flag."
	}
	return ""
}
func (h *Handler) callMCPTool(ctx context.Context, principal mcpPrincipal, name string, arguments json.RawMessage) (any, error) {
	// Revalidate on each call, including requests delivered through a reused protocol client.
	key, err := h.Queries.GetMCPKeyByHash(ctx, principal.Key.TokenHash)
	if err != nil {
		return nil, errors.New("MCP key is no longer valid")
	}
	if _, err := h.getWorkspaceMember(ctx, uuidToString(key.UserID), uuidToString(key.WorkspaceID)); err != nil {
		return nil, errors.New("workspace access revoked")
	}
	scope := "issues:read"
	if name == "xteam_issue_create" || name == "xteam_issue_update" {
		scope = "issues:write"
	}
	if name == "xteam_issue_delete" {
		scope = "issues:delete"
	}
	allowed := false
	for _, value := range key.Scopes {
		if value == scope {
			allowed = true
		}
	}
	if !allowed {
		return nil, fmt.Errorf("missing permission: %s", scope)
	}
	args := map[string]json.RawMessage{}
	if len(arguments) > 0 && json.Unmarshal(arguments, &args) != nil {
		return nil, errors.New("arguments must be an object")
	}
	if args == nil {
		return nil, errors.New("arguments must be an object")
	}
	if name == "xteam_identity" {
		return map[string]any{"user_id": uuidToString(key.UserID), "workspace_id": uuidToString(key.WorkspaceID), "scopes": key.Scopes}, nil
	}
	properties := mcpToolSchema(name)["properties"].(map[string]any)
	for field := range args {
		if _, ok := properties[field]; !ok {
			return nil, fmt.Errorf("unsupported argument %q", field)
		}
	}
	stringArg := func(field string) string { var value string; _ = json.Unmarshal(args[field], &value); return value }
	path := "/api/issues"
	method := "GET"
	var body []byte
	handler := h.ListIssues
	if name == "xteam_issue_list" || name == "xteam_issue_search" {
		values := url.Values{}
		values.Set("limit", "20")
		for _, field := range []string{"limit", "offset"} {
			if raw, ok := args[field]; ok {
				var number int
				if json.Unmarshal(raw, &number) != nil || number < 0 || (field == "limit" && (number < 1 || number > 50)) {
					return nil, errors.New("invalid pagination")
				}
				values.Set(field, strconv.Itoa(number))
			}
		}
		if name == "xteam_issue_search" {
			if strings.TrimSpace(stringArg("query")) == "" {
				return nil, errors.New("query is required")
			}
			values.Set("q", stringArg("query"))
			path += "/search"
			handler = h.SearchIssues
		}
		if status := stringArg("status"); status != "" {
			values.Set("status", status)
		}
		if project := stringArg("project_id"); project != "" {
			values.Set("project_id", project)
		}
		path += "?" + values.Encode()
	} else if name == "xteam_issue_create" {
		requestID := stringArg("request_id")
		if requestID == "" || len(requestID) > 128 {
			return nil, errors.New("request_id is required (max 128 bytes)")
		}
		delete(args, "request_id")
		body, _ = json.Marshal(args)
		identity := &service.IssueRequestIdentity{TokenHash: key.TokenHash, KeyID: key.ID, RequestID: requestID, Fingerprint: auth.HashToken(string(body))}
		ctx = context.WithValue(ctx, mcpCreateRequestKey{}, identity)
		method = "POST"
		handler = h.CreateIssue
	} else {
		id := stringArg("id")
		if id == "" {
			return nil, errors.New("id is required")
		}
		path += "/" + url.PathEscape(id)
		handler = h.GetIssue
		if name == "xteam_issue_update" {
			changes := map[string]json.RawMessage{}
			if json.Unmarshal(args["changes"], &changes) != nil || len(changes) == 0 {
				return nil, errors.New("changes is required")
			}
			for field := range changes {
				if field != "title" && field != "description" && field != "status" && field != "priority" && field != "project_id" && field != "start_date" && field != "due_date" {
					return nil, fmt.Errorf("unsupported change %q", field)
				}
			}
			changes["suppress_run"] = json.RawMessage(`true`)
			body, _ = json.Marshal(changes)
			method = "PUT"
			handler = h.UpdateIssue
		}
		if name == "xteam_issue_delete" {
			var confirmed bool
			_ = json.Unmarshal(args["confirmed"], &confirmed)
			if !confirmed {
				return nil, errors.New("explicit user authorization and confirmed=true are required")
			}
			method = "DELETE"
			handler = h.DeleteIssue
		}
	}
	// In-process transport adapter: no credential forwarding and no externally supplied actor headers.
	request, _ := http.NewRequestWithContext(ctx, method, path, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-User-ID", uuidToString(key.UserID))
	request.Header.Set("X-Workspace-ID", uuidToString(key.WorkspaceID))
	request.Header.Set("X-Client-Platform", "mcp")
	if id := stringArg("id"); id != "" {
		route := chi.NewRouteContext()
		route.URLParams.Add("id", id)
		request = request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, route))
	}
	recorder := &mcpResponse{header: make(http.Header), Code: http.StatusOK}
	handler(recorder, request)
	if recorder.Code < 200 || recorder.Code >= 300 {
		return nil, fmt.Errorf("Issue operation failed (%d): %s", recorder.Code, strings.TrimSpace(recorder.Body.String()))
	}
	if recorder.Code == 204 {
		return map[string]any{"deleted": true}, nil
	}
	var output any
	if err := json.Unmarshal(recorder.Body.Bytes(), &output); err != nil {
		return nil, errors.New("invalid Issue response")
	}
	return output, nil
}

// mcpResponse captures the existing handler contract without issuing an HTTP
// request or forwarding the MCP credential to another service.
type mcpResponse struct {
	header http.Header
	Code   int
	Body   bytes.Buffer
}

func (r *mcpResponse) Header() http.Header            { return r.header }
func (r *mcpResponse) WriteHeader(status int)         { r.Code = status }
func (r *mcpResponse) Write(body []byte) (int, error) { return r.Body.Write(body) }
