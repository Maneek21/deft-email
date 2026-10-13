export const EMAIL_FUTURE_SEND_POLICY=Object.freeze({schema_version:'deft.app_future_record_action.v1',action_key:'send_message',
 max_undo_delay_seconds:120,max_schedule_horizon_seconds:2*366*86400,max_dispatch_lifetime_seconds:300,
 missed_policies:Object.freeze(['pause_if_late','send_when_available'])});
