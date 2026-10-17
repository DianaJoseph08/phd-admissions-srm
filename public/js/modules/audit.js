// Audit history is campus-scoped by the server; all displayed values are escaped.
let auditView = {userId:null,page:1,limit:50,q:'',action:'',from:'',to:''};
let auditLoadVersion = 0;
let auditSearchTimer;
function auditEscape(value) { return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function auditTimestamp(value) {
    const raw=String(value || '');
    const date=new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(raw)?raw:raw.replace(' ','T')+'Z');
    return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(date);
}
async function renderAuditLogs() {
    const main=document.getElementById('main-content');
    if(!['admin','super_admin'].includes(state.user.role)){ main.innerHTML='<div class="card">You do not have permission to view audit logs.</div>';return; }
    if(auditView.userId!==state.user.id) auditView={userId:state.user.id,page:1,limit:50,q:'',action:'',from:'',to:''};
    main.innerHTML=`<section class="card audit-view"><div class="audit-heading"><div><h2><i class="fa-solid fa-clock-rotate-left"></i> Audit Logs</h2><p>${state.user.role==='super_admin'?'History across both campuses':'History for your campus'} · Times shown in IST</p></div><button class="btn btn-secondary" onclick="loadAuditLogPage()"><i class="fa-solid fa-arrows-rotate"></i> Refresh</button></div>
        <div class="audit-filters">
            <label>Search<input id="audit-search" class="form-control" placeholder="User, action, description or applicant ID" value="${auditEscape(auditView.q)}" oninput="queueAuditSearch(this.value)"></label>
            <label>Action<select id="audit-action" class="form-select" onchange="setAuditFilter('action',this.value)"><option value="">All actions</option></select></label>
            <label>From<input id="audit-from" class="form-control" type="date" value="${auditEscape(auditView.from)}" onchange="setAuditFilter('from',this.value)"></label>
            <label>To<input id="audit-to" class="form-control" type="date" value="${auditEscape(auditView.to)}" onchange="setAuditFilter('to',this.value)"></label>
        </div>
        <div class="table-container"><table class="data-table" id="audit-table"><thead><tr><th>Time (IST)</th><th>User</th><th>Action</th><th>Description / Targets</th><th>Result</th></tr></thead><tbody><tr><td colspan="5">Loading history…</td></tr></tbody></table></div>
        <div class="audit-pagination"><span id="audit-count" role="status"></span><div><button id="audit-prev" class="btn btn-secondary" onclick="changeAuditPage(-1)" disabled>Previous</button><span id="audit-page">Page 1</span><button id="audit-next" class="btn btn-secondary" onclick="changeAuditPage(1)" disabled>Next</button></div></div>
    </section>`;
    await loadAuditLogPage();
}
function queueAuditSearch(value) {
    auditView.q=value.trim();auditView.page=1;
    clearTimeout(auditSearchTimer);auditSearchTimer=setTimeout(loadAuditLogPage,300);
}
function setAuditFilter(key,value) { clearTimeout(auditSearchTimer);auditView[key]=value;auditView.page=1;loadAuditLogPage(); }
function changeAuditPage(delta) { auditView.page=Math.max(1,auditView.page+delta);loadAuditLogPage(); }
async function loadAuditLogPage() {
    const version=++auditLoadVersion,token=state.token;
    if(!document.querySelector('#audit-table tbody'))return;
    document.getElementById('audit-prev').disabled=true;document.getElementById('audit-next').disabled=true;
    try {
        const query=new URLSearchParams({page:auditView.page,limit:auditView.limit});
        for(const key of ['q','action','from','to'])if(auditView[key])query.set(key,auditView[key]);
        const response=await api('/api/admin/audit-logs?'+query);
        const body=document.querySelector('#audit-table tbody');
        if(!body||version!==auditLoadVersion||token!==state.token)return;
        const logs=response.logs || [];
        const total=response.total ?? logs.length;
        if(auditView.page>1&&!logs.length&&total){auditView.page=Math.max(1,Math.ceil(total/auditView.limit));return loadAuditLogPage();}
        body.innerHTML=logs.length?logs.map(log=>`<tr><td class="audit-time">${auditEscape(auditTimestamp(log.created_at))}</td><td><strong>${auditEscape(log.user_name || 'Deleted user')}</strong><small>${auditEscape(log.username || '')}${log.username?' · ':''}${auditEscape(String(log.user_role || '').replaceAll('_',' ').toUpperCase())}</small></td><td><span class="badge badge-info">${auditEscape(log.action_type)}</span></td><td>${auditEscape(log.description)}${log.target_id?'<small>Targets: '+auditEscape(log.target_id)+'</small>':''}${log.request_path?'<small>'+auditEscape(log.request_method)+' '+auditEscape(log.request_path)+'</small>':''}</td><td>${log.response_status==null?'Recorded':Number(log.response_status)<400?'<span class="audit-success">Success</span>':'<span class="audit-failure">Failed ('+Number(log.response_status)+')</span>'}</td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;padding:2rem">No audit entries match these filters.</td></tr>';
        const action=document.getElementById('audit-action');
        action.innerHTML='<option value="">All actions</option>'+[...new Set([...(response.action_types || []),...(auditView.action?[auditView.action]:[])])].map(a=>'<option value="'+auditEscape(a)+'">'+auditEscape(a.replaceAll('_',' '))+'</option>').join('');action.value=auditView.action;
        document.getElementById('audit-count').textContent=total?((auditView.page-1)*auditView.limit+1)+'–'+Math.min(auditView.page*auditView.limit,total)+' of '+total+' entries':'0 entries';
        document.getElementById('audit-page').textContent='Page '+auditView.page+' of '+Math.max(1,Math.ceil(total/auditView.limit));
        document.getElementById('audit-prev').disabled=auditView.page<=1;document.getElementById('audit-next').disabled=auditView.page*auditView.limit>=total;
    } catch(error) {
        const body=document.querySelector('#audit-table tbody');
        if(!body||version!==auditLoadVersion||token!==state.token)return;
        body.innerHTML='<tr><td colspan="5" class="audit-failure">Unable to load audit logs: '+auditEscape(error.message)+'</td></tr>';
        document.getElementById('audit-count').textContent='Use Refresh to retry.';
    }
}
