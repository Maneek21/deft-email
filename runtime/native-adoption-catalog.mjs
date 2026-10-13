export const NATIVE_TABLE_CATALOG=Object.freeze({
  "email_account_consents": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "provider",
      "principal_digest",
      "revision",
      "native_revision",
      "credential_revision",
      "state",
      "capabilities",
      "bridge_digest",
      "bridge_envelope",
      "consented_at",
      "updated_at",
      "revoked_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id"
    ]
  },
  "email_accounts": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "provider",
      "provider_draft_sync_enabled",
      "credential_source",
      "resource_binding_id",
      "retained_resource_binding_id",
      "principal_digest",
      "state",
      "authority_revision",
      "consented_at",
      "revoked_at",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id"
    ]
  },
  "email_agent_grants": {
    "columns": [
      "id",
      "org_id",
      "owner_user_id",
      "account_id",
      "principal_kind",
      "principal_id",
      "operations",
      "revision",
      "revoked_at",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "id"
    ]
  },
  "email_attachments": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "draft_id",
      "file_id",
      "upload_revision",
      "size_bytes",
      "metadata_envelope",
      "ciphertext",
      "key_version",
      "nonce_b64",
      "auth_tag_b64",
      "created_at",
      "detached_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "draft_id",
      "file_id"
    ]
  },
  "email_calendar_invitation_actions": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "request_id",
      "invitation_id",
      "payload_digest",
      "invitation_revision",
      "receipt_envelope",
      "outbox_id",
      "created_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "request_id"
    ]
  },
  "email_calendar_invitations": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "invitation_id",
      "revision",
      "sequence",
      "dtstamp",
      "content_digest",
      "logical_message_id",
      "source_digest",
      "model_envelope",
      "event_id",
      "event_fingerprint",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "invitation_id"
    ]
  },
  "email_checkpoints": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "revision",
      "cursor_envelope",
      "observed_at",
      "fresh_until",
      "coverage",
      "has_more",
      "sync_state",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id"
    ]
  },
  "email_context_transfers": {
    "columns": [
      "org_id",
      "owner_user_id",
      "request_id",
      "request_digest",
      "account_id",
      "logical_message_id",
      "source_digest",
      "mode",
      "review_digest",
      "destination_kind",
      "destination_id",
      "destination_url",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "request_id"
    ]
  },
  "email_drafts": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "draft_id",
      "revision",
      "content_revision",
      "origin",
      "created_by_user_id",
      "origin_run_id",
      "last_edited_by_user_id",
      "status",
      "content_envelope",
      "submitted_at",
      "archived_at",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "draft_id"
    ]
  },
  "email_imap_aliases": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "logical_message_id",
      "locator_key",
      "revision",
      "evidence_envelope",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "locator_key"
    ]
  },
  "email_imap_credentials": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "principal_digest",
      "connection_revision",
      "envelope",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id"
    ]
  },
  "email_imap_move_reservations": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "logical_message_id",
      "operation_id",
      "source_digest",
      "reservation_envelope",
      "created_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "logical_message_id"
    ]
  },
  "email_knowledge_budgets": {
    "columns": [
      "org_id",
      "day",
      "budget_key",
      "reserved_tokens",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "day",
      "budget_key"
    ]
  },
  "email_knowledge_observations": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "logical_message_id",
      "storage_revision",
      "policy_revision",
      "content_digest",
      "thread_key",
      "state",
      "suppressed",
      "last_error_code",
      "retry_at",
      "attempts",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "logical_message_id"
    ]
  },
  "email_knowledge_policies": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "enabled",
      "revision",
      "destination",
      "history_days",
      "include_bulk",
      "excluded_senders",
      "excluded_folders",
      "history_since",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id"
    ]
  },
  "email_knowledge_sources": {
    "columns": [
      "id",
      "org_id",
      "owner_user_id",
      "account_id",
      "logical_message_id",
      "message_revision",
      "thread_key",
      "content_digest",
      "policy_revision",
      "provider",
      "source_digest",
      "sender",
      "received_at",
      "partial",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "id"
    ]
  },
  "email_knowledge_threads": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "thread_key",
      "destination_key",
      "page_id",
      "page_version",
      "last_source_order",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "thread_key",
      "destination_key"
    ]
  },
  "email_memberships": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "logical_message_id",
      "folder",
      "inventory_generation",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "logical_message_id",
      "folder"
    ]
  },
  "email_messages": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "logical_message_id",
      "revision",
      "storage_revision",
      "received_at",
      "sort_at",
      "seen",
      "flagged",
      "answered",
      "summary_envelope",
      "source_envelope",
      "inventory_generation",
      "deleted_at",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "logical_message_id"
    ]
  },
  "email_native_account_connections": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "provider",
      "principal_digest",
      "bridge_digest",
      "revision",
      "descriptor_envelope",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id"
    ]
  },
  "email_native_connection_owners": {
    "columns": [
      "org_id",
      "owner_user_id",
      "request_count",
      "active_count",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id"
    ]
  },
  "email_native_connection_requests": {
    "columns": [
      "org_id",
      "owner_user_id",
      "request_id",
      "account_id",
      "provider",
      "request_digest",
      "binding_digest",
      "session_digest",
      "state",
      "revision",
      "state_digest",
      "envelope",
      "expires_at",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "request_id"
    ]
  },
  "email_notification_events": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "notification_id",
      "logical_message_id",
      "revision",
      "authority_revision",
      "state",
      "created_at",
      "projected_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "notification_id"
    ]
  },
  "email_notification_states": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "initial_inventory_complete",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id"
    ]
  },
  "email_operations": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "operation_id",
      "kind",
      "revision",
      "content_envelope",
      "lease_token",
      "lease_until",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "operation_id"
    ]
  },
  "email_outbox": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "outbox_id",
      "request_id",
      "operation_id",
      "draft_id",
      "draft_revision",
      "revision",
      "state",
      "job_id",
      "earliest_dispatch_at",
      "snapshot_envelope",
      "state_envelope",
      "mime_digest",
      "byte_length",
      "ciphertext",
      "key_version",
      "nonce_b64",
      "auth_tag_b64",
      "attempt_id",
      "attempt_lock_hash",
      "started_at",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "outbox_id"
    ]
  },
  "email_outbox_events": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "outbox_id",
      "revision",
      "envelope",
      "created_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "outbox_id",
      "revision"
    ]
  },
  "email_presentation_cache": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "cache_key",
      "revision",
      "content_envelope",
      "byte_length",
      "expires_at",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "cache_key"
    ]
  },
  "email_provider_draft_mirrors": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "draft_id",
      "desired_revision",
      "synced_revision",
      "generation",
      "envelope_revision",
      "claim_token_hash",
      "claim_generation",
      "claim_revision",
      "claim_operation_id",
      "state",
      "provider_envelope",
      "last_error_code",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "draft_id"
    ]
  },
  "email_provider_states": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "state_key",
      "storage_revision",
      "generation",
      "state_envelope",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "state_key"
    ]
  },
  "email_reading_preferences": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "external_images",
      "revision",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id"
    ]
  },
  "email_rule_receipts": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "rule_id",
      "rule_revision",
      "target_digest",
      "action_index",
      "operation_id",
      "storage_revision",
      "state",
      "receipt_envelope",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "rule_id",
      "rule_revision",
      "target_digest",
      "action_index"
    ]
  },
  "email_rules": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "rule_id",
      "revision",
      "state",
      "order_index",
      "content_envelope",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "rule_id"
    ]
  },
  "email_send_operations": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "operation_id",
      "draft_id",
      "draft_revision",
      "operation_digest",
      "state",
      "receipt_envelope",
      "initiated_by_user_id",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "operation_id"
    ]
  },
  "email_signatures": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "revision",
      "preferences_envelope",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id"
    ]
  },
  "email_sync_receipts": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "page_id",
      "request_digest",
      "page_digest",
      "checkpoint_revision",
      "observed_at",
      "complete",
      "has_more",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "page_id"
    ]
  },
  "email_templates": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "template_id",
      "revision",
      "status",
      "content_envelope",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "template_id"
    ]
  },
  "email_timers": {
    "columns": [
      "org_id",
      "owner_user_id",
      "account_id",
      "timer_id",
      "logical_message_digest",
      "kind",
      "revision",
      "state",
      "scheduled_at",
      "display_timezone",
      "timer_envelope",
      "firing_job_id",
      "firing_lock_token",
      "firing_lease_expires_at",
      "completed_at",
      "created_at",
      "updated_at"
    ],
    "primary_key": [
      "org_id",
      "owner_user_id",
      "account_id",
      "timer_id"
    ]
  },
  "wiki_citations": {
    "columns": [
      "id",
      "org_id",
      "page_id",
      "source_type",
      "source_id",
      "source_space_id",
      "source_user_id",
      "excerpt",
      "created_at"
    ],
    "primary_key": [
      "id"
    ]
  },
  "wiki_ops_log": {
    "columns": [
      "id",
      "org_id",
      "operation",
      "page_id",
      "details",
      "performed_by",
      "created_at"
    ],
    "primary_key": [
      "id"
    ]
  },
  "wiki_page_versions": {
    "columns": [
      "id",
      "page_id",
      "version",
      "title",
      "content",
      "summary",
      "edited_by",
      "created_at"
    ],
    "primary_key": [
      "id"
    ]
  },
  "wiki_pages": {
    "columns": [
      "id",
      "org_id",
      "scope",
      "space_id",
      "origin_space_id",
      "origin_message_id",
      "origin_user_id",
      "created_via",
      "user_id",
      "agent_employee_id",
      "type",
      "title",
      "slug",
      "summary",
      "content",
      "metadata",
      "confidence",
      "version",
      "previous_content",
      "is_deleted",
      "embedding",
      "tags",
      "referenced_user_ids",
      "created_at",
      "updated_at",
      "search_vector"
    ],
    "primary_key": [
      "id"
    ]
  }
});
