/** @jest-environment node */
import { venueBoundaryFetch } from '../venueBoundaryFetch'
import { independentVendorEvidence, readSafeDiscoveryVendor } from '@/lib/discovery/vendorRepository'
const id = '10000000-0000-4000-8000-000000000001'
const p = independentVendorEvidence('host_input','host:one','2026-11-10T12:00:00Z')
const vendor = readSafeDiscoveryVendor({ id, source:'manual_seed', name:'Host vendor', service_type:'dj', field_provenance:{name:p,service_type:p} })
const payload={ target_type:'discovery_vendor',target_id:id,target_name:vendor.name,service_type:vendor.service_type,vendor_data:vendor.vendor_data }
const signed={ snapshot_hash:'unchanged',snapshot_schema_version:2,snapshot_json:{schema_version:2,plan:{},approval:{provider:vendor.name,notes:'Received quote'},counterparty:{provider:vendor.name},action:{target_type:'discovery_vendor',target_id:id,payload_json:payload}} }
const response=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}})

describe('C2 committed response handling',()=>{
 it.each(['stage_plan_quote_booking','stage_vendor_quote_booking_checked'])('projects mutable legacy plan for %s without changing signed evidence',async rpc=>{
  const fetcher=jest.fn().mockResolvedValue(response({existing:false,plan:{id,metadata:{committed_vendors:[{discovery_vendor_id:id,name:'GOOGLE_CANARY'}]}},agent_action:{payload_json:payload},approval:signed,approval_message:{role:'agent',content:'card',metadata:{approval:signed}}}))
  const result=await venueBoundaryFetch(fetcher)(`https://example.com/rest/v1/rpc/${rpc}`,{method:'POST',body:JSON.stringify({p_action_payload:payload})})
  expect(result.status).toBe(200)
  const body=await result.json();expect(body.approval).toEqual(signed)
  expect(JSON.stringify(body)).not.toContain('GOOGLE_CANARY')
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1].cache).toBe('no-store')
  expect(result.headers.get('Cache-Control')).toContain('no-store')
 })
 it('reports SQL success with unreadable signed result as committed; no retry or compensation',async()=>{
  const fetcher=jest.fn().mockResolvedValue(response({plan:{id},approval:{...signed,snapshot_json:{...signed.snapshot_json,approval:{provider:'GOOGLE_CANARY'}}}}))
  const result=await venueBoundaryFetch(fetcher)('https://example.com/rest/v1/rpc/stage_vendor_quote_booking_checked',{method:'POST',body:'{}'})
  expect(result.status).toBe(409);expect((await result.json()).code).toBe('COMMITTED_RESPONSE_UNAVAILABLE')
  expect(fetcher).toHaveBeenCalledTimes(1)
 })
 it.each(['vendor_boundary_stage_fact_changed', 'vendor_boundary_stage_snapshot_mismatch'])('preserves only the safe checked-stage conflict %s, never row details', async message=>{
  const fetcher=jest.fn().mockResolvedValue(new Response(JSON.stringify({code:'23514',message,details:'GOOGLE_CANARY',hint:'private row'}),{status:400,headers:{'content-type':'application/json'}}))
  const result=await venueBoundaryFetch(fetcher)('https://example.com/rest/v1/rpc/stage_vendor_quote_booking_checked',{method:'POST',body:'{}'})
  expect(result.status).toBe(400)
  expect(await result.json()).toEqual({code:'23514',message,details:null,hint:null})
  expect(fetcher).toHaveBeenCalledTimes(1)
 })
 it.each(['plans','plan_versions','plan_revisions','recommendations','plan_messages','agent_actions','approvals','admin_tasks','admin_audit_log','audit_logs','templates','outreach_drafts','outreach_threads','outreach_messages','agent_runs','app_jobs'])('rejects new Google-derived copies at %s before any network call',async table=>{
  const fetcher=jest.fn()
  await expect(venueBoundaryFetch(fetcher)(`https://example.com/rest/v1/${table}`,{method:'POST',body:JSON.stringify({metadata:{discovery_vendor_id:id},external_name:'GOOGLE_CANARY',vendor_data:vendor.vendor_data})})).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
 })
})
