jest.mock('server-only',()=>({}))
import { logAgentRun } from '../agent-runs'
import { safeVenueTelemetry } from '@/lib/discovery/venuePersistence'
it('retains operational counts but never transports a mixed Google prompt/output into agent_runs',async()=>{
 const insert=jest.fn().mockResolvedValue({error:null});const db={from:jest.fn(()=>({insert}))}
 await logAgentRun(db,{userId:'host',planId:'plan',agentName:'venue_matching',status:'succeeded',inputPayload:{googleLive:{name:'GOOGLE_CANARY'}},outputPayload:{text:'GOOGLE_CANARY'},rawModelOutput:'GOOGLE_CANARY',messagesPayload:[{content:'GOOGLE_CANARY'}],error:'GOOGLE_CANARY',durationMs:12,model:'test',promptTokens:20,completionTokens:5})
 expect(JSON.stringify(insert.mock.calls)).not.toContain('GOOGLE_CANARY');expect(insert.mock.calls[0][0]).toMatchObject({plan_id:'plan',duration_ms:12,prompt_tokens:20})
})
it('redacts the whole telemetry content group instead of retaining unmarked sibling prose',()=>{
 const result=safeVenueTelemetry({plan_id:'plan',duration_ms:4,error:'GOOGLE_CANARY',google_live_overlays:{name:'GOOGLE_CANARY'}})
 expect(result).toEqual({plan_id:'plan',duration_ms:4})
})
