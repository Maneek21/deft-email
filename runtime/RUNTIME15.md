# Runtime 15 candidate

Runtime 15 repairs consent-continuation publication after an interrupted Host activation. Continuation and account-lineage rows have explicit 8 MiB plaintext budgets, while completed continuation journals compact to an exact terminal receipt and lineage digest so repeated renewals do not retain quadratic copies of account history. The 1,025th continuation is rejected before target reservation or journal creation.

An exact reviewed `status` may resume only the durable local publication plan already admitted by the Host. The compatible Host must prove `activation_started`; a reviewed but unactivated status remains read-only. Recovery validates the original review, current authority and custody, session, lineage, target scope, receipt and connected target state. It does not invoke OAuth, a provider, or an Email effect.

Deploy the matching Host phase gate before this Runtime. Runtime 15 against an older Host is unsupported because the older Host does not distinguish reviewed status from activation recovery. App 13, App Kit 38, Runtime Kit 35, provider behavior and exact-message Send review are unchanged.

These are candidate behavior and offline regression results. Exact-head deployment, live two-account renewal, browser acceptance and delivery evidence remain separate checks.
