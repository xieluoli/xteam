package handler

// Schema and handler validation share the same accepted field names. Never
// expose the ordinary Issue API's assignment or execution arguments over MCP.
func mcpToolSchema(name string) map[string]any {
	text := func() map[string]any { return map[string]any{"type": "string"} }
	fields := map[string]any{}
	required := []string{}
	issueFields := func() map[string]any {
		result := map[string]any{}
		for _, field := range []string{"title", "description", "status", "priority", "project_id", "start_date", "due_date"} {
			result[field] = text()
		}
		result["priority"] = map[string]any{"type": "string", "enum": validIssuePriorities}
		return result
	}
	switch name {
	case "xteam_issue_list", "xteam_issue_search":
		fields["limit"] = map[string]any{"type": "integer", "minimum": 1, "maximum": 50}
		fields["offset"] = map[string]any{"type": "integer", "minimum": 0}
		if name == "xteam_issue_search" {
			fields["query"] = text()
			required = []string{"query"}
		} else {
			fields["status"] = text()
			fields["project_id"] = text()
		}
	case "xteam_issue_get":
		fields["id"] = text()
		required = []string{"id"}
	case "xteam_issue_create":
		fields = issueFields()
		fields["request_id"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 128}
		required = []string{"request_id", "title"}
	case "xteam_issue_update":
		fields["id"] = text()
		changes := issueFields()
		for _, field := range []string{"description", "project_id", "start_date", "due_date"} {
			changes[field] = map[string]any{"type": []string{"string", "null"}}
		}
		fields["changes"] = map[string]any{"type": "object", "properties": changes, "additionalProperties": false, "minProperties": 1}
		required = []string{"id", "changes"}
	case "xteam_issue_delete":
		fields["id"] = text()
		fields["confirmed"] = map[string]any{"type": "boolean"}
		required = []string{"id", "confirmed"}
	}
	return map[string]any{"type": "object", "properties": fields, "required": required, "additionalProperties": false}
}
