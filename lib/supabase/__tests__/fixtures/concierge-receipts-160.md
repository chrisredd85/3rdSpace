These five receipts were captured from actual disposable PostgreSQL calls against
all 160 migrations at `fb6bc4b9f027adc3ee394d5f6deee5f32886f257` on 2026-11-11.
The fixture contains fake test identities and independently seeded supplier facts,
not production data. The SQL invoked normal/repeated completion, normal/repeated
cancellation, and `cancel_approved_admin_task`. Signed evidence remained unchanged;
there were three outcome messages for three tasks, not five.

Original JSON SHA256:
`136ccf13173b0e0adac9068d853ea4a3e4883aaa60710a9f4171ed490849f9ce`.

The source evidence and execution SQL are preserved in the C2 ACTIVATE build gate's
`test-results/ws2a-b3-c2-activate-build/rls/` artifacts. These tests replay the captured
responses through the real reader/transport with an in-memory fetch; they do not
claim a new live SQL execution. The `161-projected` test cases are explicitly modeled
from the approved return contract; migration 161 is not implemented or applied here.
