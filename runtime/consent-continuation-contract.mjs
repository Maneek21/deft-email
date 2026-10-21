import * as Kit from '@deft/app-kit/core';
import {digest,fail} from './contract.mjs';
import {createReattachChecker} from './reattach-contract.mjs';
export const CONTINUATION_VERSION='deft.app_connection_consent_continuation_runtime.v1';
export function validateContinuationRequest(raw){const result=Kit.AppConnectionConsentContinuationRuntimeRequestSchema.safeParse(raw);if(!result.success)fail('EMAIL_RUNTIME_INPUT_INVALID');return result.data;}
const wire=request=>request.operation?request:{schema_version:CONTINUATION_VERSION,operation:'prepare',expires_at:request.review_expires_at,...request};
export const continuationPins=request=>Kit.appConnectionConsentContinuationPins(wire(request));
export const continuationReviewDigest=(request,eligibility)=>'sha256:'+digest(Kit.appConnectionConsentContinuationReviewValue(wire(request),eligibility));
export const continuationReceiptDigest=(request,review,ref)=>'sha256:'+digest(Kit.appConnectionConsentContinuationReceiptValue(request.operation?request:{...wire(request),operation:'activate',review},review,ref));
export const createContinuationChecker=createReattachChecker;
