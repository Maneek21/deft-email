import {createSourceSnapshotCache} from './source-snapshot-cache.mjs';
import {createReadSessionSnapshot} from './read-session-snapshot.mjs';
import {createForegroundDiagnostics} from './foreground-diagnostics.mjs';
import {assertNoCredentialRepair,wrapCredentialProviderBridge} from './credential-repair-reservation.mjs';
import {nativeHistoryData} from './native-history-data.mjs';
import {deriveCalendarRsvp} from './integration-destinations.mjs';
import {createNativeIdentityScopeResolver,readNativeIdentity} from './native-adoption-identity.mjs';
import {assertNativeSessionVisible} from './native-adoption-activation.mjs';
import {ruleRecordRequest} from './rules-data.mjs';
import {previewCurrentRule,ruleScope} from './rules-runtime.mjs';
import {mailboxStatusRecord,mailboxStatusId} from './mailbox-status.mjs';
import {createImapMoveAliases} from './imap-move-aliases.mjs';
import {createHash} from 'node:crypto';
import {createNativeEmailBridge as createUnfencedNativeEmailBridge} from './vendor/providers/native-mailbox.mjs';
const createNativeEmailBridge=options=>wrapCredentialProviderBridge({bridge:createUnfencedNativeEmailBridge(options),store:options.store,scope:{...options.selected.scope,resource_binding_id:options.selected.resource_binding_id}});
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {grantedOAuthCapabilities,validateOAuthClient,oauthClientFingerprint} from './vendor/providers/oauth-provider.mjs';
import {validateEmailAccount} from './vendor/account-registry.mjs';
import {canonical,digest,exact,fail,validateRegistration} from './contract.mjs';
import {createDraftStore,uuid} from './draft-store.mjs';
import {createMailboxStore,resourceView} from './mailbox-store.mjs';
import {integrationKnowledgePresentation} from './integration-knowledge.mjs';
import {createDataChecker,dataInputDigest,validateDataRequest,validateDataResult} from './data-contract.mjs';
import {createPreparedActions} from './prepared-actions.mjs';
import {deriveReply} from './reply-compose.mjs';
import {readResourceBytes} from './resource-bytes.mjs';
import {createOwnedSourceResolver} from './account-lineage.mjs';
import {readArchive} from './archive-read.mjs';
import {createForegroundCache} from './foreground-cache.mjs';
import {copyOriginalFile} from './file-copy.mjs';
import {purposeFor} from './purpose-set.mjs';
import {createResourcePlanStore} from './resource-plan-store.mjs';
import {prepareResourceAction,readPreparedResourceAction} from './resource-actions.mjs';
import {buildRecordChange} from './record-change-native.mjs';
import {createSettingsStore,SETTINGS_STORES} from './settings-store.mjs';
import {createFolderCatalogStore} from './folder-catalog-store.mjs';
import {validateChangeRequest,createChangeChecker,validateChangeResult} from './record-change-contract.mjs';
import {executeRecordChange} from './record-change-runtime.mjs';
import {createImapReadPorts} from './imap-runtime-ports.mjs';
import {createSmtpCompoundSend} from './smtp-compound.mjs';
import {smtpSentCopySupport,savedSmtpSentCopyMode} from './smtp-settings.mjs';
import {currentImapOwnedSource} from './imap-owned-source.mjs';

const localReadPaths=new Set(['resource_list','resource_refresh','resource_read_metadata','resource_read_presentation','resource_list_files','resource_read_source','resource_read_file','resource_read_image']);
const mutationOperations=new Set(['record_create','record_save','record_archive','file_upload','file_copy','file_detach','prepare_action','prepare_resource_action','prepared_action_commit','prepared_action_restore']);
const identityOperations=new Set(['connection_metadata','record_create','record_read','record_save','record_archive','file_upload','file_copy','file_detach']);
const digestBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
export const recordView=record=>({schema_version:'deft.app_record.v1',store_key:'drafts',record_id:record.draft_id,revision:record.revision,content_revision:record.content_revision,content_digest:'sha256:'+record.content_digest,status:record.status,value:record.content,files:record.file_catalog.map(file=>({...file,sha256:'sha256:'+file.sha256})),summary:{...(Object.hasOwn(record.content,'author_note')?{author_note_supported:true}:{}),subject:record.content.subject,to:record.content.to.slice(0,2048),mode:record.content.mode,...(record.calendar_reply?{calendar_reply_immutable:true}:{}),...(record.send_effect?{send_state:record.send_effect.state,run_id:record.send_effect.run_id,...(record.send_effect.release_id?{future_submission_id:record.send_effect.release_id}:{})}:{}),...(record.origin?{notice:record.origin.notice}:{})},created_at:record.created_at,updated_at:record.updated_at,...(record.origin?{source_refs:[{resource_key:record.origin.resource_key,record_id:record.origin.record_id,content_digest:record.origin.content_digest}]}:{})});
const accountFromRecord=(binding,record,{allowNativeReauth=false}={})=>{if(!record?.secret?.identity||record.health!=='connected'&&!(allowNativeReauth&&record.health==='reauth_required'))return null;const identity=record.secret.identity;return validateEmailAccount({account_id:binding.account_id,provider:binding.provider,display_label:identity.display_label,primary_address:identity.primary_address,verified_sender_identities:[...identity.verified_sender_identities],capabilities:grantedOAuthCapabilities(binding,record.secret.scopes),connection_target:binding.connection_target,resource_binding_id:binding.resource_binding_id,action_binding_id:binding.action_binding_id,authority_epoch:binding.authority_epoch,health:record.health});};
function verifiedPrimary(account,identities){const primary=account.primary_address?.trim().toLocaleLowerCase('en-US');return identities.find(row=>row.address.trim().toLocaleLowerCase('en-US')===primary)??null;}
function inputObject(input,fields){exact(input,fields);if(fields.includes('store_key')&&input.store_key!=='drafts'||fields.includes('resource_key')&&typeof input.resource_key!=='string')fail('EMAIL_DATA_INPUT_INVALID');}
/** The public data envelope carries nominations only. Current host authority,
 * pinned local connection/client, and the native engine all independently guard
 * owner/account scope. This process owns every durable record and provider byte. */
export function createDataRuntime({registrations,getRegistrations,client,provider='gmail',forms,imapConnector,store,encryption_key,key_id,assertCurrent,fetch:fetchImpl=globalThis.fetch,now=Date.now,imageDependencies,preparedActions,sentCopyMode='server_managed',onDiagnostic}){
  if(!['server_managed','append_exact'].includes(sentCopyMode))fail('EMAIL_DATA_CONFIG_INVALID');const formMode=provider==='imap_smtp';if(formMode&&(!forms||!imapConnector)||!formMode&&(forms||imapConnector))fail('EMAIL_DATA_CONFIG_INVALID');
  registrations=registrations.map(({connection_protocol,...pins})=>validateRegistration(pins));if(!formMode)client=validateOAuthClient(provider,client);const fingerprint=formMode?'credential_form.v1':oauthClientFingerprint(provider,client),custody=formMode?null:createEncryptedEmailCustody({encryption_key,key_id,store,now,recover_gmail_refresh:true}),drafts=createDraftStore({store,now}),mailbox=createMailboxStore({store,now,imapAliases:formMode?createImapMoveAliases({store}):null});
  preparedActions??=createPreparedActions({store,now});const resourcePlans=createResourcePlanStore({store,now});const sourceCache=createSourceSnapshotCache({now}),memo=createForegroundCache({now}),settings=createSettingsStore({store,now}),catalog=createFolderCatalogStore({store,now});
  async function executeRequest(raw,signal,uploadedBytes,recipientRead){
    const change=raw?.schema_version==='deft.app_data_runtime.v2',request=change?validateChangeRequest(raw):validateDataRequest(raw),registration=(getRegistrations?getRegistrations().map(({connection_protocol,...r})=>validateRegistration(r)):registrations).find(value=>value.org_id===request.scope.org_id&&value.runtime_registration_id===request.scope.runtime_registration_id);
    if(!registration||Object.keys(registration).some(field=>registration[field]!==request.scope[field]))fail('EMAIL_RUNTIME_REGISTRATION_DENIED');
    const trace=createForegroundDiagnostics({request_id:request.request_id,operation:request.operation,onDiagnostic});let requestError;
    const guard=(change?createChangeChecker:createDataChecker)({request,assertCurrent,signal,now}),hostCheck=()=>trace.span('authority',guard.check);
    const sessionLock=async work=>{const queued=trace.start('session_queue');try{return await store.withLock({key:'email.runtime.session.'+request.connection.session_id},tx=>{queued();return trace.span('session_hold',()=>work(tx));});}catch(error){queued(error);throw error;}};
    const optimistic=!formMode&&!change&&localReadPaths.has(request.operation)&&!request.input.query?.startsWith('folder-ref:')&&!request.input.query?.startsWith('rule-preview:');
    const withSession=async work=>{if(optimistic)return work(await createReadSessionSnapshot({withLock:sessionLock,check:guard.checkLocal}));if(!formMode)return sessionLock(work);const queued=trace.start('session_queue');try{return await forms.withDataSession(request.connection,request.scope,guard.checkLocal,tx=>{queued();return trace.span('session_hold',()=>work(tx));});}catch(error){queued(error);throw error;}};
    try{await hostCheck();
     // Read the adoption journal before holding a session lock; publication
     // locks journal then session. Visibility only advances after both commits.
     if(!formMode)await trace.span('visibility',async()=>assertNativeSessionVisible({store,session:(await store.withLock({key:'email.runtime.session.'+request.connection.session_id},tx=>tx.read()))?.value}));
     return await withSession(async sessionTx=>{
      const session=(await sessionTx.read())?.value; if(change||mutationOperations.has(request.operation)||request.operation==='resource_refresh')await assertNoCredentialRepair({store,scope:request.scope});
      const checkLocal=()=>{guard.checkLocal();if(!session||session.state!=='connected'||canonical(session.scope)!==canonical(request.scope)||session.runtime_session_ref!==request.connection.runtime_session_ref||session.account?.account_ref!==request.connection.account_ref||session.binding.account_id!==request.connection.account_ref||session.client_fingerprint!==fingerprint||session.binding.provider!==provider)fail('EMAIL_DATA_CONNECTION_DENIED');};
      let changeGeneration=null,changeIdentityPins=null;
      const identityPins=account=>canonical([account.primary_address,account.verified_sender_identities.map(address=>address.trim().toLocaleLowerCase('en-US')).sort()]);
      const currentChangeAccount=async()=>{if(formMode){checkLocal();const row=await sessionTx.currentAccount();const account={primary_address:row.profile.primary_address,display_label:row.profile.display_label,verified_sender_identities:[row.profile.primary_address],capabilities:row.capabilities};if(!account.capabilities.includes('read')||!Number.isSafeInteger(row.custody_generation)||row.custody_generation<1||changeGeneration!==null&&changeGeneration!==row.custody_generation||changeIdentityPins!==null&&changeIdentityPins!==identityPins(account))fail('EMAIL_DATA_CONNECTION_DENIED');checkLocal();return {account,generation:row.custody_generation};}return custody.withAccount(session.binding,async tx=>{checkLocal();const row=tx.read(),account=accountFromRecord(session.binding,row);if(account?.health!=='connected'||!account?.capabilities.includes('read')||canonical(row.binding)!==canonical(session.binding)||row.secret.client_fingerprint!==fingerprint||!Number.isSafeInteger(row.setup_generation)||row.setup_generation<1||changeGeneration!==null&&changeGeneration!==row.setup_generation||changeIdentityPins!==null&&changeIdentityPins!==identityPins(account))fail('EMAIL_DATA_CONNECTION_DENIED');checkLocal();return {account,generation:row.setup_generation};});};
      const check=async()=>{await hostCheck();if(optimistic)await sessionTx.assertCurrent();checkLocal();if(change&&changeGeneration!==null)await currentChangeAccount();};
      // Record changes recheck online under their journal lock. Local checks
      // retain the request deadline, session and current custody at every read.
      const checkChangeLocal=async()=>{checkLocal();if(changeGeneration!==null)await currentChangeAccount();};
      if(change)checkLocal();else await check();
      const scope={org_id:request.scope.org_id,owner_user_id:request.scope.owner_user_id,account_id:request.connection.account_ref},input=request.input;
      const withPinnedSession=work=>optimistic?sessionTx.withLocked(work):work();
      if(change){const current=await currentChangeAccount();changeGeneration=current.generation;changeIdentityPins=identityPins(current.account);const identities=current.account.verified_sender_identities.map(address=>({address,label:address===current.account.primary_address?current.account.display_label:address}));
        const result=await executeRecordChange({request,scope,session,store,drafts,settings,check,localCheck:checkChangeLocal,identities,primary_identity:verifiedPrimary(current.account,identities),now,recordView,generation:changeGeneration});validateChangeResult(result,request);await check();return result;}
      const historyRead=input.store_key==='native_history';
      if(historyRead&&(formMode||request.authority.consent_id===null||!['record_list','record_read','file_read'].includes(request.operation)))fail('EMAIL_NATIVE_HISTORY_DENIED');
      const ruleStore=['rules','rules_order'].includes(input.store_key),setting=SETTINGS_STORES.includes(input.store_key),settingsScope=input.store_key==='folder_preferences'?{...scope,installation_id:request.scope.installation_id}:scope;
      const catalogRead=input.store_key==='folders';
      const statusRead=input.store_key==='mailbox_status';
      if(ruleStore&&(!['record_create','record_read','record_list','record_save','record_archive','request_status'].includes(request.operation)||request.authority.consent_id===null))fail('EMAIL_DATA_INPUT_INVALID');
      if(statusRead&&(!['record_list','record_read'].includes(request.operation)||request.authority.consent_id===null))fail('EMAIL_DATA_INPUT_INVALID');
      if(catalogRead&&(formMode||!['record_read','record_list'].includes(request.operation)||request.authority.consent_id===null)||!historyRead&&!catalogRead&&!statusRead&&!ruleStore&&input.store_key!=='drafts'&&!setting||setting&&(!['record_create','record_read','record_list','record_save','record_archive','connection_metadata','request_status'].includes(request.operation)||request.authority.consent_id===null))fail('EMAIL_DATA_INPUT_INVALID');
      const allowNativeReauth=!formMode&&!!await readNativeIdentity(store,scope,session.binding,checkLocal,session);
      const heldForms=formMode?{currentAccount:async()=>{checkLocal();return sessionTx.currentAccount();}}:null;
      const sourceFor=formMode?record=>currentImapOwnedSource({forms:heldForms,session_id:request.connection.session_id,scope:request.scope,record,check,store}):createOwnedSourceResolver({store,session,scope,check:checkLocal});
      const fetchCurrent=async(url,options={})=>{await trace.span('pre_provider',async()=>{await check();if(allowNativeReauth)fail('EMAIL_NATIVE_PROVIDER_RECONNECT_REQUIRED');await assertNoCredentialRepair({store,scope:request.scope});});return trace.span('provider_http',()=>fetchImpl(url,{...options,signal:AbortSignal.any([guard.signal,options.signal].filter(Boolean))}));};
      const bridge=formMode?createImapReadPorts({forms:heldForms,connector:imapConnector,session_id:request.connection.session_id,scope:request.scope,check,imageDependencies,now}).bridge:createNativeEmailBridge({store,identityScopeFor:createNativeIdentityScopeResolver({store,scope,session,binding:session.binding,check:checkLocal}),selected:session.binding,clients:{[provider]:client},custody,accountFromRecord:(binding,row)=>accountFromRecord(binding,row,{allowNativeReauth}),now,imageDependencies,fetch:fetchCurrent,oauthFetch:optimistic?async(url,options={})=>{await hostCheck();checkLocal();if(allowNativeReauth)fail('EMAIL_NATIVE_PROVIDER_RECONNECT_REQUIRED');await assertNoCredentialRepair({store,scope:request.scope});return trace.span('provider_http',()=>fetchImpl(url,{...options,signal:AbortSignal.any([guard.signal,options.signal].filter(Boolean))}));}:fetchCurrent});
      const readCheck=localReadPaths.has(request.operation)?checkLocal:check;
      // OAuth/native custody reads stay local under this held session. Every
      // provider HTTP call still uses fetchCurrent, and disclosure rechecks online.
      const nativeContext=()=>({org_id:scope.org_id,owner_user_id:scope.owner_user_id,account_id:scope.account_id,installation_id:request.scope.installation_id,resource_binding_id:request.scope.resource_binding_id,authority_version:digest([request.scope,request.connection,request.authority]),expires_at:guard.expires_at,recheck:formMode?(request.operation==='resource_read_image'?check:readCheck):checkLocal,signal:guard.signal,owner_capabilities:['read'],...(formMode?{imap_aliases:{lookup:locator=>createImapMoveAliases({store}).lookup(scope,locator,checkLocal)}}:{})});
      // Native SQL rechecks are local inside this exact held session. Every
      // injected provider fetch above is freshly online. Image DNS/redirect
      // boundaries separately use the explicit online resource-bytes guard.
      const memoEligible=request.operation==='resource_list'&&Boolean(input.query)&&!input.query.startsWith('folder-ref:')&&!input.anchor_record_id||['resource_read_presentation','resource_list_files'].includes(request.operation);
      const custodyGeneration=async()=>formMode?(await heldForms.currentAccount()).custody_generation:custody.withAccount(session.binding,async tx=>{checkLocal();const row=tx.read(),account=accountFromRecord(session.binding,row);if(account?.health!=='connected'||!account?.capabilities.includes('read')||canonical(row.binding)!==canonical(session.binding)||row.secret.client_fingerprint!==fingerprint||!Number.isSafeInteger(row.setup_generation)||row.setup_generation<1)fail('EMAIL_DATA_CONNECTION_DENIED');checkLocal();return row.setup_generation;});
      // Internal saved-recipient reads retain the exact source lock and custody
      // generation throughout the bounded scan, then recheck Host authority.
      if(recipientRead){
        if(change||request.operation!=='connection_metadata'||input.store_key!=='drafts'||uploadedBytes!==undefined)fail('EMAIL_DATA_INPUT_INVALID');
        const pinnedGeneration=await custodyGeneration();
        const recipientCheckLocal=async()=>{checkLocal();if(await custodyGeneration()!==pinnedGeneration)fail('EMAIL_DATA_CONNECTION_DENIED');checkLocal();};
        await recipientCheckLocal();
        const value=await recipientRead({scope,drafts,checkLocal:recipientCheckLocal});
        await check();await recipientCheckLocal();return value;
      }
      const localSettingRead=setting&&input.store_key==='preferences'&&['record_read','record_list'].includes(request.operation);
      const partialPublication=()=>({publication_intent:'partial_observation',sync_producer:{scope:request.scope,session_id:request.connection.session_id,runtime_session_ref:request.connection.runtime_session_ref,custody_generation:generation,client_fingerprint:formMode?digest({connection_protocol:fingerprint}):fingerprint}});
      const commitMailbox=(...args)=>withPinnedSession(async()=>{checkLocal();if(generation!==null&&await custodyGeneration()!==generation)fail('EMAIL_DATA_CONNECTION_DENIED');return mailbox.commit(...args);});
      const generation=localReadPaths.has(request.operation)||localSettingRead?await custodyGeneration():null,memoKey=memoEligible?memo.key(request,{client_fingerprint:fingerprint,custody_generation:generation}):null;let pendingMemo=null,disclosureStamp=null;
      let identities=[],primary_identity=null;
      // Cache-only reads still need current custody health/capability validation.
      // Provider-backed reads perform it in their native bridge; only record
      // responses and connection metadata need the verified alias projection.
      const needsIdentities=identityOperations.has(request.operation),needsAccount=needsIdentities||['record_list','file_read','request_status','read_prepared'].includes(request.operation)||request.operation==='resource_list'&&!input.query&&!input.anchor_record_id;
      if(needsAccount&&!historyRead){const nativeAccount=await bridge.nativeEmailAccount(nativeContext());if(needsIdentities&&nativeAccount.capabilities){
        if(formMode){const account=await heldForms.currentAccount();identities=[{address:account.profile.primary_address,label:account.profile.display_label}];primary_identity=identities[0];}
        else identities=await custody.withAccount(session.binding,async tx=>{checkLocal();const account=accountFromRecord(session.binding,tx.read(),{allowNativeReauth});const values=account.verified_sender_identities.map(address=>({address,label:address===account.primary_address?account.display_label:address}));primary_identity=verifiedPrimary(account,values);return values;});
      }}
      const base={schema_version:'deft.app_data_result.v1',request_id:request.request_id,operation:request.operation,input_digest:dataInputDigest(request),outcome:'completed'};
      const journalKey=id=>'email.data.request.'+digest([ruleStore?ruleScope(scope,request.scope.installation_id):input.store_key==='folder_preferences'?settingsScope:scope,id]);
      const execute=async()=>{
        if(historyRead)return nativeHistoryData({store,scope,session,request,base,check,checkLocal});
        if(ruleStore&&request.operation!=='request_status')return ruleRecordRequest({store,scope:ruleScope(scope,request.scope.installation_id),request,base,check});
        if(statusRead){if(request.operation==='record_read'){exact(input,['store_key','record_id']);if(input.record_id!==mailboxStatusId(scope))fail('EMAIL_DATA_NOT_FOUND');}else{exact(input,['store_key','cursor','limit']);if(input.cursor!==null||!Number.isInteger(input.limit)||input.limit<1||input.limit>25)fail('EMAIL_DATA_INPUT_INVALID');}const record=mailboxStatusRecord(scope,await mailbox.unreadSnapshot(scope,[],check,{localCheck:checkLocal}));if(request.operation==='record_read')return {...base,record,identities:[]};const {value,files,...meta}=record;return {...base,items:[meta],next_cursor:null};}
        if(catalogRead){const catalogScope={...scope,installation_id:request.scope.installation_id};if(request.operation==='record_list'){exact(input,['store_key','cursor','limit']);const root=await catalog.root(catalogScope,provider,checkLocal),page=await bridge.nativeEmailFolders({cursor:input.cursor,limit:input.limit>1?input.limit-1:1},nativeContext()),rows=await catalog.publish(catalogScope,page,checkLocal);if(input.cursor===null&&input.limit>1)rows.unshift(root);return {...base,items:rows.map(({value,files,...meta})=>meta),next_cursor:page.next_cursor};}exact(input,['store_key','record_id']);return {...base,record:await catalog.refresh(catalogScope,input.record_id,id=>bridge.nativeEmailFolderRead({id},nativeContext()),checkLocal),identities:[]};}

        const options={request_id:request.request_id,user_id:scope.owner_user_id,check};
        const copySupport=()=>smtpSentCopySupport({account:null,connector:imapConnector,check,signal:guard.signal,expires_at:guard.expires_at,now});
        const currentCopySupport=async()=>formMode?smtpSentCopySupport({account:await heldForms.currentAccount(),connector:imapConnector,check,signal:guard.signal,expires_at:guard.expires_at,now}):copySupport();
        if(setting&&request.operation!=='request_status'){
          if(input.store_key==='folder_preferences'&&['record_create','record_save'].includes(request.operation)){await catalog.get({...scope,installation_id:request.scope.installation_id},input.value?.folder_record_id,check);}
          if(input.store_key==='smtp_preferences'&&request.operation==='record_save'&&input.value?.sent_copy_mode==='append_exact'){const support=await currentCopySupport();if(!support.append_available)fail('EMAIL_SMTP_COPY_DESTINATION_DENIED');}
          const key=input.store_key,settingOptions={...options,identities,public_input_digest:base.input_digest,expected_revision:input.expected_revision,expected_content_digest:input.expected_content_digest};
          if(request.operation==='connection_metadata'){exact(input,['store_key',...(input.seed?['seed']:[])]);if(!input.seed)return {...base,identities,primary_identity};exact(input.seed,['operation_key','destination_store_key','value']);if(key!=='signatures'||input.seed.operation_key!=='signature_default'||input.seed.destination_store_key!=='drafts'||input.seed.value?.mode!=='compose'||input.seed.value.attachments?.length||['to','cc','bcc','subject','body','body_html','reply_record_id'].some(k=>input.seed.value[k]!==''))fail('EMAIL_SIGNATURE_DEFAULT_DENIED');let cursor=null,pages=0,matches=[];do{if(++pages>2)fail('EMAIL_SIGNATURE_DEFAULT_DENIED');const page=await settings.list(settingsScope,key,{cursor,limit:25},check);matches.push(...page.items.filter(row=>row.summary.address?.toLowerCase()===primary_identity?.address?.toLowerCase()));cursor=page.next_cursor;}while(cursor);let value=input.seed.value;if(matches.length===1){const source=await settings.read(settingsScope,key,matches[0].record_id,check);if(source.value.automatic?.enabled===true&&['new','both'].includes(source.value.placement))value=buildRecordChange({operation_key:'signature_default',invocation_mode:'initial',destination:{content:value,revision:1,content_revision:1,status:'draft'},source,identities,primary_identity}).value;}await check();return {...base,identities,primary_identity,record_seed_value:value};}
          if(request.operation==='record_create'){exact(input,['store_key','record_id','value']);return {...base,record:await settings.create(settingsScope,key,input.record_id,input.value,settingOptions),identities};}
          if(request.operation==='record_read'){exact(input,['store_key','record_id']);let record=await settings.read(settingsScope,key,input.record_id,localSettingRead?checkLocal:check);if(key==='smtp_preferences')record={...record,summary:{...record.summary,...await currentCopySupport()}};return {...base,record,identities,primary_identity,...(key==='preferences'?{document_policy:{schema_version:'deft.app_record_document_policy.v1',field:'external_images',automatic_value:'always'}}:{})};}
          if(request.operation==='record_list'){exact(input,['store_key','cursor','limit']);return {...base,...await settings.list(settingsScope,key,input,localSettingRead?checkLocal:check)};}
          if(request.operation==='record_save'){exact(input,['store_key','record_id','expected_revision','expected_content_digest','value']);return {...base,record:await settings.save(settingsScope,key,input.record_id,input.value,settingOptions),identities};}
          if(request.operation==='record_archive'){exact(input,['store_key','record_id','expected_revision','expected_content_digest']);return {...base,record:await settings.archive(settingsScope,key,input.record_id,settingOptions),identities};}
        }
        const existingDraft=async()=>{const record=await drafts.read(scope,input.record_id,check);if(record.revision!==input.expected_revision||'sha256:'+record.content_digest!==input.expected_content_digest)fail('EMAIL_DRAFT_CONFLICT');return record;};
        if(['prepared_action_commit','prepared_action_restore'].includes(request.operation)){
          const phase=request.operation==='prepared_action_commit'?'commit':'restore';
          const receipt=await preparedActions.withSnapshot(scope,input.snapshot_id,check,async(value,persist)=>{
            if(!value.prepared.future_release||value.prepared.snapshot_digest!==input.snapshot_digest||value.prepared.record_id!==input.record_id||value.prepared.input.content_digest!==input.expected_content_digest||(phase==='commit'?canonical(value.connection)!==canonical(request.connection):value.connection.account_ref!==request.connection.account_ref))fail('EMAIL_SEND_SNAPSHOT_DENIED');
            const release={release_id:input.release_id,run_id:input.run_id,original_request_id:input.original_request_id,snapshot_digest:input.snapshot_digest};
            if(value.future_local_release&&canonical(value.future_local_release)!==canonical(release))fail('EMAIL_SEND_SNAPSHOT_DENIED');
            if(phase==='commit'){
              if(value.state!=='prepared'||value.prepared.revision!==input.expected_revision||Date.parse(value.prepared.expires_at)<=now())fail('EMAIL_SEND_SNAPSHOT_DENIED');
              if(!value.future_local_release){await check();await persist({...value,future_local_release:release});}
            }else if(!value.future_local_release||value.state!=='prepared')fail('EMAIL_SEND_SNAPSHOT_DENIED');
            return drafts.futureLifecycle(scope,input,{request_id:request.request_id,phase,check});
          });
          return {...base,prepared_action_receipt:receipt};
        }
        // A source-pinned seed reads the exact original without creating any
        // draft. The opaque marker is revalidated and removed on first save.
        const replySeed=async(raw,{creating=false}={})=>{
          const marker=raw.record_seed;exact(marker,['schema_version','source',...(creating?['source_digest','mode']:[])]);const ref=marker.source;exact(ref,['resource_key','record_id','content_digest']);
          if(marker.schema_version!=='deft.email_reply_seed.v1'||ref.resource_key!==request.scope.resource_key||!uuid(ref.record_id)||!/^sha256:[a-f0-9]{64}$/u.test(ref.content_digest??'')||!['reply','reply_all','forward'].includes(raw.mode))fail('EMAIL_DATA_INPUT_INVALID');
          const {record_seed:_,...content}=raw;
          if(!creating&&(['to','cc','bcc','subject','body','body_html','reply_record_id'].some(key=>content[key]!=='')||content.attachments?.length||content.from_identity||content.managed_signature))fail('EMAIL_DATA_INPUT_INVALID');
          const anchor=await mailbox.get(scope,ref.record_id,check);if(resourceView(anchor).content_digest!==ref.content_digest)fail('EMAIL_DATA_SOURCE_CHANGED');
          const source=await bridge.nativeEmailPresentation({source:await sourceFor(anchor)},nativeContext()),derived=deriveReply(source,anchor.logical_message_id,raw.mode),source_digest='sha256:'+source.source_digest;
          if(creating&&(marker.mode!==raw.mode||marker.source_digest!==source_digest||content.reply_record_id!==anchor.logical_message_id))fail('EMAIL_DATA_SOURCE_CHANGED');
          const origin={resource_key:ref.resource_key,record_id:ref.record_id,content_digest:ref.content_digest,source_digest,logical_message_id:anchor.logical_message_id,notice:derived.notice};
          return creating?{value:content,origin}:{value:{...derived.content,...(Object.hasOwn(content,'author_note')?{author_note:content.author_note}:{}),record_seed:{...marker,source_digest,mode:raw.mode}},origin};
        };
        if(request.operation==='connection_metadata'){
          inputObject(input,['store_key',...(Object.hasOwn(input,'seed')?['seed']:[])]);if(!input.seed)return {...base,identities,primary_identity};
          exact(input.seed,['operation_key','destination_store_key','value']);if(input.seed.operation_key!=='record_seed'||input.seed.destination_store_key!=='drafts')fail('EMAIL_DATA_INPUT_INVALID');
          const seeded=await replySeed(input.seed.value);return {...base,identities,primary_identity,record_seed_value:seeded.value};
        }
        if(request.operation==='record_create'){
          inputObject(input,['store_key','record_id','value',...(Object.hasOwn(input,'source_refs')?['source_refs']:[])]);let value=input.value,origin=null,calendar_reply=null;
          if(value?.record_seed){if(input.source_refs?.length)fail('EMAIL_DATA_INPUT_INVALID');const seeded=await replySeed(value,{creating:true});value=seeded.value;origin=seeded.origin;}
          else if(value?.record_intent==='calendar_rsvp'){const derived=await deriveCalendarRsvp({value,source_refs:input.source_refs,resource_key:request.scope.resource_key,check,now,read:async ref=>{const anchor=await mailbox.get(scope,ref.record_id,check);if(resourceView(anchor).content_digest!==ref.content_digest)fail('EMAIL_DATA_SOURCE_CHANGED');return bridge.nativeEmailCalendarParts({source:await sourceFor(anchor)},nativeContext());}});value=derived.value;origin=derived.origin;calendar_reply=derived.calendar_reply;}
          else
          if(input.source_refs?.length){
            if(input.source_refs.length!==1)fail('EMAIL_DATA_INPUT_INVALID');const ref=input.source_refs[0];exact(ref,['resource_key','record_id','content_digest']);
            if(ref.resource_key!==request.scope.resource_key||!['reply','reply_all','forward'].includes(value.mode)||['to','cc','bcc','subject','body','body_html','reply_record_id'].some(key=>value[key]!=='')||value.attachments?.length||value.from_identity||value.managed_signature)fail('EMAIL_DATA_INPUT_INVALID');
            const anchor=await mailbox.get(scope,ref.record_id,check);if(resourceView(anchor).content_digest!==ref.content_digest)fail('EMAIL_DATA_SOURCE_CHANGED');
            const source=await bridge.nativeEmailPresentation({source:await sourceFor(anchor)},nativeContext()),derived=deriveReply(source,anchor.logical_message_id,value.mode);value=derived.content;origin={resource_key:ref.resource_key,record_id:ref.record_id,content_digest:ref.content_digest,source_digest:'sha256:'+source.source_digest,logical_message_id:anchor.logical_message_id,notice:derived.notice};
          }else if(value.mode!=='compose'||value.reply_record_id!=='')fail('EMAIL_DATA_INPUT_INVALID');
          return {...base,record:recordView(await drafts.create(scope,input.record_id,value,{...options,origin,calendar_reply})),identities};
        }
        // Pure saved-draft reads keep local deadlines inside the held session;
        // fresh online checks still guard entry, lock acquisition and disclosure.
        if(request.operation==='record_read'){inputObject(input,['store_key','record_id']);return {...base,record:recordView(await drafts.read(scope,input.record_id,checkLocal)),identities,primary_identity};}
        if(request.operation==='record_list'){inputObject(input,['store_key','cursor','limit']);if(input.limit>25)fail('EMAIL_DATA_INPUT_INVALID');const page=await drafts.list(scope,input,checkLocal);return {...base,items:page.items.map(record=>{const {value,files,...meta}=recordView(record);return meta;}),next_cursor:page.next_cursor};}
        if(request.operation==='record_save'){inputObject(input,['store_key','record_id','expected_revision','expected_content_digest','value']);await existingDraft();return {...base,record:recordView(await drafts.save(scope,input.record_id,input.expected_revision,input.value,options)),identities};}
        if(request.operation==='record_archive'){inputObject(input,['store_key','record_id','expected_revision','expected_content_digest']);await existingDraft();return {...base,record:recordView(await drafts.archive(scope,input.record_id,input.expected_revision,options)),identities};}
        if(request.operation==='file_upload'){inputObject(input,['store_key','record_id','expected_revision','expected_content_digest','file_id','filename','media_type','size_bytes','sha256']);await existingDraft();if(!/^sha256:[a-f0-9]{64}$/u.test(input.sha256??''))fail('EMAIL_DATA_INPUT_INVALID');const metadata={file_id:input.file_id,filename:input.filename,media_type:input.media_type,size_bytes:input.size_bytes,sha256:input.sha256.slice(7)};return {...base,record:recordView(await drafts.upload(scope,input.record_id,input.expected_revision,metadata,uploadedBytes,options)),identities};}
        if(request.operation==='file_copy')return {...base,record:recordView(await copyOriginalFile({request,scope,input,drafts,mailbox,bridge,sourceFor,context:nativeContext(),check})),identities};
        if(request.operation==='file_read'){inputObject(input,['store_key','record_id','file_id','upload_revision','sha256']);if(!/^sha256:[a-f0-9]{64}$/u.test(input.sha256??''))fail('EMAIL_DATA_INPUT_INVALID');const record=await drafts.read(scope,input.record_id,check),file=await drafts.readFile(scope,input.record_id,input.file_id,record.revision,check,{upload_revision:input.upload_revision,sha256:input.sha256.slice(7)});const {bytes,...metadata}=file;return {schema_version:'deft.app_data_binary.v1',request_id:request.request_id,operation:request.operation,input_digest:base.input_digest,record_id:input.record_id,...metadata,sha256:'sha256:'+metadata.sha256,bytes};}
        if(request.operation==='file_detach'){inputObject(input,['store_key','record_id','expected_revision','expected_content_digest','file_id','upload_revision','sha256']);const record=await existingDraft(),active=record.file_catalog.find(file=>file.file_id===input.file_id);if(!active||active.upload_revision!==input.upload_revision||'sha256:'+active.sha256!==input.sha256)fail('EMAIL_DRAFT_FILE_DENIED');return {...base,record:recordView(await drafts.detach(scope,input.record_id,input.expected_revision,input.file_id,options)),identities};}
        if(request.operation==='request_status'){
          exact(input,['store_key','request_id']);if(!uuid(input.request_id))fail('EMAIL_DATA_INPUT_INVALID');const row=await store.withLock({key:journalKey(input.request_id)},tx=>tx.read());await check();
          if(!row)return {...base,request_status:{request_id:input.request_id,operation:'request_status',input_digest:base.input_digest,state:'not_found'}};
          const journal=row.value;if(canonical(journal.scope)!==canonical(scope)||journal.input.store_key!==input.store_key)fail('EMAIL_DATA_AUTHORITY_DENIED');
          const status={request_id:input.request_id,operation:journal.operation,input_digest:journal.input_digest,state:journal.state==='completed'?'completed':'indeterminate'};
          if(journal.state==='completed'){const record=journal.result.record;return {...base,request_status:{...status,...(record?{record_id:record.record_id,revision:record.revision,content_digest:record.content_digest}:{}),...(journal.result.prepared_action_receipt?{prepared_action_receipt:journal.result.prepared_action_receipt}:{})}};}
          if(['prepared_action_commit','prepared_action_restore'].includes(journal.operation)){
            const receipt=await drafts.futureLifecycleStatus(scope,journal.input.record_id,input.request_id,check);
            return {...base,request_status:receipt?{...status,state:'completed',prepared_action_receipt:receipt}:status};
          }
          if(setting){const receipt=journal.input.record_id?await settings.receipt(settingsScope,input.store_key,journal.input.record_id,input.request_id,check):null;return {...base,request_status:receipt&&receipt.public_input_digest===journal.input_digest?{...status,state:'completed',record_id:journal.input.record_id,revision:receipt.revision,content_digest:'sha256:'+receipt.content_digest}:status};}
          if(journal.operation==='record_apply_change'){
            const recovered=await store.withLock({key:'email.data.draft.'+digest([scope.org_id,scope.owner_user_id,scope.account_id,journal.input.record_id])},tx=>tx.read());const receipt=recovered?.value.receipts.find(value=>value.request_id===input.request_id&&value.public_input_digest===journal.input_digest);
            return {...base,request_status:receipt?{...status,state:'completed',record_id:journal.input.record_id,revision:receipt.revision,content_digest:'sha256:'+receipt.content_digest}:status};
          }
          // A crash can occur after draft CAS but before its response journal.
          // Only a matching durable mutation receipt can reconcile this state.
          if(journal.input.record_id&&mutationOperations.has(journal.operation)&&journal.operation!=='prepare_action'){
            const recovered=await store.withLock({key:'email.data.draft.'+digest([scope.org_id,scope.owner_user_id,scope.account_id,journal.input.record_id])},tx=>tx.read());const receipt=recovered?.value.receipts.find(value=>value.request_id===input.request_id);
            if(receipt)return {...base,request_status:{...status,state:'completed',record_id:journal.input.record_id,revision:receipt.revision,content_digest:'sha256:'+receipt.content_digest}};
          }
          if(journal.operation==='prepare_action'){
            let recovered;try{recovered=await preparedActions.read(scope,input.request_id,check);}catch(error){if(error.code!=='EMAIL_SEND_SNAPSHOT_DENIED')throw error;}
            if(recovered&&recovered.prepared.record_id===journal.input.record_id&&recovered.prepared.revision===journal.input.expected_revision&&recovered.prepared.input.content_digest===journal.input.expected_content_digest&&recovered.prepared.action_key===journal.input.action_key)return {...base,request_status:{...status,state:'completed',record_id:recovered.prepared.record_id,revision:recovered.prepared.revision,content_digest:recovered.prepared.input.content_digest}};
          }
          return {...base,request_status:status};
        }
        if(request.operation==='prepare_action'||request.operation==='read_prepared'){if(request.operation==='prepare_action'&&!formMode)purposeFor(session,'send_message',now);if(!preparedActions)fail('EMAIL_DATA_OPERATION_UNAVAILABLE');return {...base,prepared:await preparedActions[request.operation]({request,scope,input,drafts,mailbox,bridge,sourceFor,nativeContext: nativeContext(),actionConsents:session.action_consents??[],check,localCheck:checkLocal,signal:guard.signal,...(formMode?{prepareCopy:async args=>createSmtpCompoundSend({forms,store,connector:imapConnector,now}).prepare({...args,connection:request.connection,scope:request.scope,mode:await savedSmtpSentCopyMode({settings,scope,check,fallback:sentCopyMode}),check,signal:guard.signal,expires_at:guard.expires_at,held_session:sessionTx})}: {})})};}
        if(['prepare_resource_action','read_prepared_resource_action'].includes(request.operation))return {...base,prepared_resource:await (request.operation==='prepare_resource_action'?prepareResourceAction:readPreparedResourceAction)({request,scope,input,session,client,custody,plans:resourcePlans,mailbox,sourceFor,check,checkLocal,signal:guard.signal,fetch:fetchCurrent,now,forms:heldForms,connector:imapConnector,store,catalog,folderRead:id=>bridge.nativeEmailFolderRead({id},nativeContext())})};
        if(input.store_key!=='drafts'||input.resource_key!==request.scope.resource_key)fail('EMAIL_DATA_INPUT_INVALID');
        if(request.operation==='resource_refresh'){
          inputObject(input,['store_key','resource_key']);memo.invalidate(scope);const checkpoint=(await mailbox.cacheSnapshot(scope,[],checkLocal)).stamp.checkpoint_generation;const context=nativeContext();context.provider_state=await mailbox.providerState(scope,checkLocal);const page=await bridge.nativeEmailPage({cursor:await mailbox.cursor(scope,checkLocal),limit:25},context);const freshness=await withPinnedSession(async()=>{if((await mailbox.cacheSnapshot(scope,[],checkLocal)).stamp.checkpoint_generation!==checkpoint)fail('EMAIL_DATA_SOURCE_CHANGED');return commitMailbox(scope,page,check,{localCheck:checkLocal,sync_producer:{scope:request.scope,session_id:request.connection.session_id,runtime_session_ref:request.connection.runtime_session_ref,custody_generation:generation,client_fingerprint:formMode?digest({connection_protocol:fingerprint}):fingerprint}});});return {...base,freshness};
        }
        if(request.operation==='resource_list'){
          inputObject(input,['store_key','resource_key','cursor','limit',...(Object.hasOwn(input,'query')?['query']:[]),...(Object.hasOwn(input,'anchor_record_id')?['anchor_record_id']:[])]);
          if(input.anchor_record_id){if(input.query)fail('EMAIL_DATA_INPUT_INVALID');const anchor=await mailbox.get(scope,input.anchor_record_id,readCheck),page=await bridge.nativeEmailConversation({source:await sourceFor(anchor),cursor:input.cursor,limit:input.limit},nativeContext()),batch=await commitMailbox(scope,{...page,tombstones:[],state_updates:[],complete:false},check,{localCheck:checkLocal,include_items:true,...partialPublication()});return {...base,...batch,next_cursor:page.next_cursor};}
          if(input.query?.startsWith('rule-preview:'))return {...base,...await previewCurrentRule({store,scope:ruleScope(scope,request.scope.installation_id),query:input.query,mailbox,sourceFor,check,checkLocal,limit:input.limit,cursor:input.cursor})};
                    if(input.query){let folderReferenceRow=null;if(input.query.startsWith('folder-ref:')){const match=/^folder-ref:([a-f0-9-]{36}):([1-9][0-9]*):([a-f0-9]{64})$/u.exec(input.query);if(!match)fail('EMAIL_CATALOG_REFERENCE_DENIED');folderReferenceRow=await catalog.resolve({...scope,installation_id:request.scope.installation_id},{store_key:'folders',record_id:match[1],expected_revision:Number(match[2]),expected_content_digest:'sha256:'+match[3]},id=>bridge.nativeEmailFolderRead({id},nativeContext()),check);if(folderReferenceRow.catalog_root)fail('EMAIL_CATALOG_REFERENCE_DENIED');}const snapshot=await mailbox.cacheSnapshot(scope,[],checkLocal),cached=memo.get(memoKey,snapshot.stamp);if(cached){const current=await mailbox.cacheSnapshot(scope,cached.items.map(row=>row.record_id),checkLocal);if(current)for(const row of current.records)await sourceFor(row);if(current&&canonical(current.stamp)===canonical(snapshot.stamp)&&current.records.every((row,index)=>resourceView(row).content_digest===cached.items[index].content_digest)){disclosureStamp=current.stamp;return {...base,...cached,freshness:{...cached.freshness,provider_observed:false}};}memo.invalidate(scope);}const query={query:input.query,cursor:input.cursor,limit:input.limit},page=folderReferenceRow?await bridge.nativeEmailFolderPage({...query,id:folderReferenceRow.provider_id},nativeContext()):input.query==='in:archive'&&provider==='gmail'?await readArchive({identityScopeFor:createNativeIdentityScopeResolver({store,scope,session,binding:session.binding,check:checkLocal}),input:query,binding:session.binding,client,custody,accountFromRecord,check:checkLocal,fetch:fetchCurrent,signal:guard.signal,expiresAt:()=>guard.expires_at,now}):await bridge.nativeEmailSearch(query,nativeContext()),search={status:page.status,original_query:page.original_query,unsupported:page.unsupported,limitations:page.limitations,query_complete:page.query_complete};
           // Unsupported translation is not provider observation, empty success,
           // cache membership evidence, or a checkpoint. Preserve it explicitly.
           if(page.status==='unsupported')return {...base,items:[],next_cursor:null,search};
           if(page.status!=='supported')fail('EMAIL_DATA_RESULT_INVALID');const {cache_stamp,...batch}=await commitMailbox(scope,{...page,tombstones:[],state_updates:[],complete:false},check,{localCheck:checkLocal,include_items:true,include_cache_stamp:true,...partialPublication()});disclosureStamp=cache_stamp;const payload={...batch,next_cursor:page.next_cursor,search};pendingMemo={payload,observed_at:now()};return {...base,...payload};}
          const page=await mailbox.list(scope,input,readCheck);return {...base,...page};
        }
        const record=await mailbox.get(scope,input.record_id,readCheck);
        if(resourceView(record).content_digest!==input.content_digest)fail('EMAIL_DATA_SOURCE_CHANGED');
        if(request.operation==='resource_read_metadata'){inputObject(input,['store_key','resource_key','record_id','content_digest']);const snapshot=await mailbox.cacheSnapshot(scope,[input.record_id],checkLocal);if(!snapshot?.records[0]||resourceView(snapshot.records[0]).content_digest!==input.content_digest)fail('EMAIL_DATA_SOURCE_CHANGED');disclosureStamp=snapshot.stamp;return {...base,resource:resourceView(snapshot.records[0])};}
        const provider_source=await sourceFor(record);
        if(request.operation==='resource_read_source'){inputObject(input,['store_key','resource_key','record_id','content_digest']);const source=await bridge.nativeEmailSource({source:provider_source},nativeContext());try{await withPinnedSession(()=>mailbox.cacheSource(scope,record,source,check));return {schema_version:'deft.app_data_binary.v1',request_id:request.request_id,operation:request.operation,input_digest:base.input_digest,record_id:record.record_id,filename:'message.eml',media_type:'message/rfc822',size_bytes:source.mime_bytes.length,sha256:'sha256:'+source.digest,bytes:source.mime_bytes};}catch(error){source.mime_bytes.fill(0);throw error;}}
        if(['resource_read_file','resource_read_image'].includes(request.operation)){const ref=request.operation==='resource_read_file'?'file_ref':'image_ref';inputObject(input,['store_key','resource_key','record_id','content_digest',ref,...(ref==='image_ref'?['external_images']:[])]);const value=await readResourceBytes({bridge,provider_source,input,operation:request.operation,context:nativeContext(),check,imageDependencies,sourceCache,sourceCacheKey:digest({scope:request.scope,connection:request.connection,client_fingerprint:fingerprint,custody_generation:generation,provider_source,content_digest:input.content_digest})});const {bytes}=value;return {schema_version:'deft.app_data_binary.v1',request_id:request.request_id,operation:request.operation,input_digest:base.input_digest,record_id:record.record_id,size_bytes:bytes.length,sha256:'sha256:'+digestBytes(bytes),media_type:value.media_type,filename:value.filename??'message-image',bytes};}
        const snapshot=await mailbox.cacheSnapshot(scope,[],checkLocal),cached=memo.get(memoKey,snapshot.stamp);disclosureStamp=snapshot.stamp;const sourceView=cached??await bridge.nativeEmailPresentation({source:provider_source},nativeContext()),files=sourceView.files.map(file=>({...file,file_ref:'sha256:'+file.file_ref}));if(!cached)pendingMemo={payload:sourceView,observed_at:now()};
        if(['resource_read_presentation','resource_list_files'].includes(request.operation)){inputObject(input,['store_key','resource_key','record_id','content_digest']);const presentation={...sourceView.presentation,source_digest:'sha256:'+sourceView.source_digest,...(request.operation==='resource_read_presentation'?{external_images:(await settings.list(scope,'preferences',{cursor:null,limit:1},checkLocal)).items[0]?.summary.external_images??'ask'}:{}),images:sourceView.presentation.images.map(image=>({...image,image_ref:'sha256:'+image.image_ref})),...(sourceView.reply_seed_unavailable?{reply_seed_unavailable:sourceView.reply_seed_unavailable}:{})};return request.operation==='resource_list_files'?{...base,files}:{...base,resource:resourceView(record),files,presentation:integrationKnowledgePresentation(record,presentation)};}
        fail('EMAIL_DATA_INPUT_INVALID');
      };
      if(!mutationOperations.has(request.operation)){let result;try{result=await execute();}catch(error){if(['EMAIL_DRAFT_NOT_FOUND','EMAIL_DATA_NOT_FOUND','EMAIL_SETTINGS_NOT_FOUND','EMAIL_RULE_NOT_FOUND'].includes(error.code))result={...base,outcome:'not_found'};else if(['EMAIL_DRAFT_CONFLICT','EMAIL_SETTINGS_CONFLICT','EMAIL_RULE_CONFLICT'].includes(error.code))result={...base,outcome:'conflict'};else throw error;}try{validateDataResult(result,request);await check();if(optimistic&&result.outcome==='completed'&&input.record_id&&request.operation.startsWith('resource_')&&resourceView(await mailbox.get(scope,input.record_id,checkLocal)).content_digest!==input.content_digest)fail('EMAIL_DATA_SOURCE_CHANGED');if((localReadPaths.has(request.operation)||localSettingRead)&&await custodyGeneration()!==generation)fail('EMAIL_DATA_CONNECTION_DENIED');if(memoEligible||request.operation==='resource_read_metadata'){checkLocal();const snapshot=await mailbox.cacheSnapshot(scope,[],checkLocal);if(disclosureStamp&&canonical(snapshot.stamp)!==canonical(disclosureStamp))fail('EMAIL_DATA_SOURCE_CHANGED');if(pendingMemo&&result.outcome==='completed'){memo.set(memoKey,scope,snapshot.stamp,pendingMemo.payload,pendingMemo.observed_at);}}return result;}catch(error){result.bytes?.fill(0);throw error;}}
      return store.withLock({key:journalKey(request.request_id)},async tx=>{
        await check();const row=await tx.read();if(row){if(row.value.input_digest!==base.input_digest||row.value.operation!==request.operation||canonical(row.value.scope)!==canonical(scope))fail('EMAIL_DATA_CONFLICT');await check();return row.value.state==='completed'?row.value.result:{...base,outcome:'indeterminate'};}
        const journal={schema_version:'email.app_mutation.v1',scope,operation:request.operation,input_digest:base.input_digest,input,state:'started',result:null};if(!await tx.compareAndSwap({expected_revision:null,value:journal}))fail('EMAIL_DATA_CONFLICT');
        let result;try{result=await execute();await check();}catch(error){if(['EMAIL_DRAFT_CONFLICT','EMAIL_SETTINGS_CONFLICT','EMAIL_RULE_CONFLICT'].includes(error.code))result={...base,outcome:'conflict'};else if(['EMAIL_DRAFT_NOT_FOUND','EMAIL_DATA_NOT_FOUND','EMAIL_SETTINGS_NOT_FOUND','EMAIL_RULE_NOT_FOUND'].includes(error.code))result={...base,outcome:'not_found'};else throw error;}
        validateDataResult(result,request);const current=await tx.read();if(!await tx.compareAndSwap({expected_revision:current.revision,value:{...journal,state:'completed',result}}))fail('EMAIL_DATA_CONFLICT');await check();return result;
      });
    });}catch(error){requestError=error;if(['EMAIL_DATA_AUTHORITY_DENIED','EMAIL_DATA_CONNECTION_DENIED','EMAIL_DATA_SOURCE_CHANGED'].includes(error.code))sourceCache.invalidate();throw error;}finally{guard.dispose();trace.finish(requestError);}
  }
  const request=(raw,signal,uploadedBytes)=>executeRequest(raw,signal,uploadedBytes);
  const withRecipientMetadataRead=(raw,signal,work)=>{if(typeof work!=='function')fail('EMAIL_DATA_INPUT_INVALID');return executeRequest(raw,signal,undefined,work);};
  return Object.freeze({request,withRecipientMetadataRead,drafts,mailbox,custody,settings,close(){sourceCache.close();}});
}



