import test from 'node:test';
import assert from 'node:assert/strict';
import {EMAIL_INTEGRATION_TOOL_DECLARATIONS, EMAIL_INTEGRATION_TOOL_INPUTS} from './ten-tool-schema.mjs';

const declaration = key => EMAIL_INTEGRATION_TOOL_DECLARATIONS.find(row => row.key === key);
const READ_ONLY_DATA_OPERATIONS = ['resource_list', 'resource_read_presentation'];

// NOTE: `email_draft_mirror` is intentionally absent until the published Author Kit
// ships the generic `prepare_record_mirror` data-operation (Kit alpha.43). The pinned
// alpha.42 declaration schema rejects that operation, and review-mode tools must carry
// `prepare_action`/`prepare_resource_action`, so the draft-to-Drafts mirror nomination
// is "blocked on Kit release".

test('delegated read tools are read-only and visible to Defty', () => {
  for (const key of ['email_list', 'email_read', 'email_thread', 'email_search']) {
    const row = declaration(key);
    assert.ok(row, `${key} is declared`);
    assert.equal(row.operation, 'read', `${key} operation`);
    assert.equal(row.mode, 'data', `${key} mode`);
    assert.equal(row.visibility, 'delegated_tools', `${key} visibility`);
    assert.equal(row.action_key, undefined, `${key} carries no write action_key`);
    assert.ok(row.data_operations.length >= 1, `${key} has a data operation`);
    for (const op of row.data_operations)
      assert.ok(READ_ONLY_DATA_OPERATIONS.includes(op), `${key} only performs read-only data operations, got ${op}`);
  }
});

test('email_accounts is a delegated catalog read tool with no data operations', () => {
  const row = declaration('email_accounts');
  assert.ok(row);
  assert.equal(row.operation, 'read');
  assert.equal(row.mode, 'catalog');
  assert.equal(row.visibility, 'delegated_tools');
  assert.deepEqual(row.data_operations, []);
  assert.equal(row.action_key, undefined);
});

test('recipient suggestions remain human-only and are never delegated', () => {
  const row = declaration('email_recipient_suggestions');
  assert.ok(row);
  assert.equal(row.operation, 'read');
  assert.equal(row.visibility, 'human_only');
});

test('every delegated read tool exposes a valid account-scoped input schema', () => {
  for (const key of ['email_accounts', 'email_list', 'email_read', 'email_thread', 'email_search']) {
    const row = declaration(key);
    assert.ok(row, `${key} is declared`);
    assert.equal(row.input_schema.type, 'object', `${key} input schema type`);
    assert.equal(row.input_schema.additionalProperties, false, `${key} input schema is closed`);
    assert.ok(Object.hasOwn(EMAIL_INTEGRATION_TOOL_INPUTS, key), `${key} has an input definition`);
    if (row.mode !== 'catalog') {
      assert.ok(Object.hasOwn(row.input_schema.properties, 'account_id'), `${key} declares account_id`);
      assert.ok(row.input_schema.required.includes('account_id'), `${key} requires account_id`);
    }
  }
});
