package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type contextReference struct {
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Location string `json:"location"`
	Version  string `json:"version,omitempty"`
	Notes    string `json:"notes,omitempty"`
}
type contextSection struct {
	NotApplicable bool               `json:"not_applicable"`
	References    []contextReference `json:"references"`
}
type projectContextDocument struct {
	Revision     int64                     `json:"revision"`
	Entrypoint   *contextReference         `json:"entrypoint"`
	ReadingNotes string                    `json:"reading_notes"`
	Sections     map[string]contextSection `json:"sections"`
}

func emptyProjectContext() projectContextDocument {
	result := projectContextDocument{Sections: map[string]contextSection{}}
	for _, key := range []string{"requirements", "code", "design", "lessons"} {
		result.Sections[key] = contextSection{References: []contextReference{}}
	}
	return result
}

func validateContextReference(ref *contextReference) error {
	ref.Name = strings.TrimSpace(ref.Name)
	ref.Location = strings.TrimSpace(ref.Location)
	if ref.Name == "" || len(ref.Name) > 200 || ref.Location == "" || len(ref.Location) > 2048 || len(ref.Notes) > 4000 || len(ref.Version) > 200 {
		return errors.New("reference name/location is required and fields must fit their limits")
	}
	switch ref.Kind {
	case "path":
		if strings.Contains(ref.Location, "://") || strings.ContainsAny(ref.Location, "\r\n\x00") {
			return errors.New("path must be a plain file location, not a URL")
		}
	case "url":
		parsed, err := url.Parse(ref.Location)
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Hostname() == "" || parsed.User != nil {
			return errors.New("source must be an http(s) URL without credentials")
		}
		for key := range parsed.Query() {
			normalized := strings.ToLower(key)
			for _, secret := range []string{"token", "secret", "password", "signature", "credential", "api_key", "apikey", "authorization"} {
				if strings.Contains(normalized, secret) {
					return errors.New("source URL must not contain credentials or signed access parameters")
				}
			}
		}
		if strings.Contains(strings.ToLower(parsed.Fragment), "token=") {
			return errors.New("source URL must not contain credentials")
		}
	default:
		return errors.New("reference kind must be url or path")
	}
	return nil
}

func normalizeProjectContext(doc *projectContextDocument) error {
	if len(doc.ReadingNotes) > 8000 {
		return errors.New("reading notes exceed 8000 characters")
	}
	if doc.Entrypoint != nil {
		if err := validateContextReference(doc.Entrypoint); err != nil {
			return err
		}
	}
	defaults := emptyProjectContext()
	for key, section := range doc.Sections {
		if _, ok := defaults.Sections[key]; !ok {
			return fmt.Errorf("unknown context section %q", key)
		}
		if len(section.References) > 50 || (section.NotApplicable && len(section.References) > 0) {
			return errors.New("a section supports at most 50 references and cannot be both configured and not applicable")
		}
		for index := range section.References {
			if err := validateContextReference(&section.References[index]); err != nil {
				return err
			}
		}
		if section.References == nil {
			section.References = []contextReference{}
		}
		defaults.Sections[key] = section
	}
	doc.Sections = defaults.Sections
	return nil
}

func (h *Handler) GetProjectContext(w http.ResponseWriter, r *http.Request) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if _, ok := h.requireWorkspaceMember(w, r, uuidToString(project.WorkspaceID), "project not found"); !ok {
		return
	}
	doc := emptyProjectContext()
	stored, err := h.Queries.GetProjectContext(r.Context(), project.ID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 500, "failed to load project context")
		return
	}
	if err == nil {
		if json.Unmarshal(stored.Document, &doc) != nil {
			writeError(w, 500, "invalid stored project context")
			return
		}
		doc.Revision = stored.Revision
	}
	writeJSON(w, 200, doc)
}

func (h *Handler) UpdateProjectContext(w http.ResponseWriter, r *http.Request) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	member, ok := h.requireWorkspaceRole(w, r, uuidToString(project.WorkspaceID), "project not found", "owner", "admin")
	if !ok {
		return
	}
	var doc projectContextDocument
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&doc); err != nil {
		writeError(w, 400, "invalid context document")
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		writeError(w, 400, "expected one context document")
		return
	}
	if doc.Revision < 0 {
		writeError(w, 400, "invalid context revision")
		return
	}
	if err := normalizeProjectContext(&doc); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	bytes, err := json.Marshal(doc)
	if err != nil {
		writeError(w, 500, "failed to encode context")
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "failed to start context update")
		return
	}
	defer tx.Rollback(r.Context())
	queries := h.Queries.WithTx(tx)
	if _, err := queries.LockWorkspaceForChatSessionCreate(r.Context(), project.WorkspaceID); err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	if _, err := queries.LockProjectForDelete(r.Context(), db.LockProjectForDeleteParams{ID: project.ID, WorkspaceID: project.WorkspaceID}); err != nil {
		writeError(w, 404, "project not found")
		return
	}
	var count int64
	if doc.Revision == 0 {
		count, err = queries.CreateProjectContext(r.Context(), db.CreateProjectContextParams{ProjectID: project.ID, Document: bytes})
	} else {
		count, err = queries.UpdateProjectContext(r.Context(), db.UpdateProjectContextParams{ProjectID: project.ID, Document: bytes, Revision: doc.Revision})
	}
	if err != nil {
		writeError(w, 500, "failed to save project context")
		return
	}
	if count == 0 {
		writeError(w, 409, "project context changed; reload before saving")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, 500, "failed to commit project context")
		return
	}
	doc.Revision++
	h.publish(protocol.EventProjectUpdated, uuidToString(project.WorkspaceID), "member", uuidToString(member.UserID), map[string]any{"project": projectToResponse(project)})
	writeJSON(w, 200, doc)
}
