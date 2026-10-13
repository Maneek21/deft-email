// Adapted from the frozen HTML93 Email search explanation contract.
export function emailSearchUnsupportedReason(value){
 const field=value.field?`“${value.field}:”`:'This filter';
 switch(value.reason){
  case 'unknown_operator':return `${field} is not recognized in Email search. Try words, from:, to:, cc: or subject:.`;
  case 'boolean_or_group_not_supported':return 'OR, NOT and grouped expressions are not supported. Combine terms and use - to exclude a term.';
  case 'status_not_supported':return 'This state filter is not supported. Use is:unread, is:read or is:starred where the account supports it.';
  case 'attachment_operator_not_supported':return 'Use has:attachment for attachment searches where the account supports it.';
  case 'internal_date_not_received_utc':case 'kql_received_utc_range_not_supported_by_current_port':return 'Date filters are not supported for this account. Edit the query to search this account.';
  case 'status_not_searchable_in_message_kql':return 'Read and starred state filters are not supported for this account. Edit the query to search this account.';
  case 'attachment_requires_reviewed_mime_evidence':return 'Attachment filters are not supported for this account. Edit the query to search this account.';
  case 'literal_escape_or_wildcard_not_portable':return 'Literal quotes, backslashes and wildcard characters are not supported for this account. Edit the query and search again.';
  case 'negated_day_range_not_supported':return 'Excluding a day with -on: is not supported for this account. Edit the query and search again.';
  case 'compiled_query_limit':return 'This search is too long for this account. Shorten it and search again.';
  case 'folder_scope_not_supported':return 'Use in:inbox, in:sent, in:drafts, in:spam or in:trash to search a provider folder.';
  case 'negated_folder_scope_not_supported':return 'Excluding a folder with -in: is not supported. Choose one positive in: folder filter.';
  case 'conflicting_folder_scopes':return 'Choose one provider folder per query. Different in: folder filters cannot be combined.';
  case 'folder_scope_unavailable':return 'This account could not identify a selectable provider folder for this filter. Choose another folder or edit the query.';
  default:return 'This account cannot use part of this query. Edit the query and search again.';
 }
}
export const emailSearchHelp='Combine words or from:, to:, cc: and subject: filters. Quotes keep a phrase together; - excludes a term. Use one provider folder with in:inbox, in:sent, in:drafts, in:spam or in:trash. Provider Drafts are separate from saved Deft drafts. Date, read/starred and attachment filters vary by account. Custom folder names, label: and -in: are not supported.';
