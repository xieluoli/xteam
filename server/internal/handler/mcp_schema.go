package handler

// Schema and handler validation share the same accepted field names. Never
// expose the ordinary Issue API's assignment or execution arguments over MCP.
func mcpToolSchema(name string) map[string]any {
	text := func() map[string]any { return map[string]any{"type": "string"} }
	fields := map[string]any{}
	required := []string{}
	issueFields := func() map[string]any {
		result := map[string]any{}
		for _, field := range []string{"title", "description", "status", "priority", "project_id", "start_date", "due_date", "parent_issue_id"} {
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
	case "xteam_issue_get", "xteam_issue_usage_list":
		fields["id"] = text()
		required = []string{"id"}
	case "xteam_issue_create":
		fields = issueFields()
		fields["request_id"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 128}
		required = []string{"request_id", "title"}
	case "xteam_issue_update":
		fields["id"] = text()
		changes := issueFields()
		for _, field := range []string{"description", "project_id", "start_date", "due_date", "parent_issue_id"} {
			changes[field] = map[string]any{"type": []string{"string", "null"}}
		}
		fields["changes"] = map[string]any{"type": "object", "properties": changes, "additionalProperties": false, "minProperties": 1}
		required = []string{"id", "changes"}
	case "xteam_issue_usage_import":
		fields["id"] = text()
		for _, field := range []string{"source_workspace_id", "source_issue_id", "source_issue_identifier", "source_name", "captured_at"} {
			fields[field] = text()
		}
		count := func() map[string]any {
			return map[string]any{"type": "integer", "minimum": 0, "maximum": 9007199254740991}
		}
		for _, field := range []string{"input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "task_count"} {
			fields[field] = count()
		}
		fields["coverage"] = map[string]any{"type": []string{"object", "null"}, "properties": map[string]any{"terminal_task_count": count(), "metered_task_count": count(), "unreported_task_count": count()}, "required": []string{"terminal_task_count", "metered_task_count", "unreported_task_count"}, "additionalProperties": false}
		required = []string{"id", "source_workspace_id", "source_issue_id", "source_issue_identifier", "source_name", "captured_at", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "task_count"}
	case "xteam_issue_delete":
		fields["id"] = text()
		fields["confirmed"] = map[string]any{"type": "boolean"}
		required = []string{"id", "confirmed"}
	}
	return map[string]any{"type": "object", "properties": fields, "required": required, "additionalProperties": false}
}
