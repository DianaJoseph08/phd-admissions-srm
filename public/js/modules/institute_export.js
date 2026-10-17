// Institute exports always use the complete, server-authorized candidate pool.
function instituteApplicationCounts(candidates) {
    const counts = {received: candidates.length, complete: 0, incomplete: 0, otherStatus: 0, fullTime: 0, partTime: 0, external: 0, internal: 0, academic: 0, industry: 0, otherPartTime: 0, otherMode: 0};
    for (const candidate of candidates) {
        const status = String(candidate.form_status || '').trim().toLowerCase();
        if (['complete', 'completed'].includes(status)) counts.complete++;
        else if (status === 'incomplete') counts.incomplete++;
        else counts.otherStatus++;
        const mode = String(candidate.mode_of_study || '').toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
        if (/full\s*time/.test(mode)) counts.fullTime++;
        else if (/part\s*time/.test(mode)) {
            counts.partTime++;
            if (mode.includes('external')) {counts.external++; if (mode.includes('academic')) counts.academic++; else if (mode.includes('industry')) counts.industry++;}
            else if (mode.includes('internal')) counts.internal++;
            else counts.otherPartTime++;
        } else counts.otherMode++;
    }
    return counts;
}
function buildInstituteApplicationsWorkbook(candidates, institute, departments, XLSXLib = XLSX) {
    const scoped = candidates.filter(c => Number(c.institution_id) === Number(institute.id) && Number(c.campus_id) === Number(institute.campus_id));
    const workbook = XLSXLib.utils.book_new();
    const names = new Map((departments || []).filter(d => Number(d.institution_id) === Number(institute.id)).map(d => [String(d.id), d.name]));
    for (const c of scoped) if (!names.has(String(c.department_id))) names.set(String(c.department_id ?? 'unmapped'), c.department_name || 'Unclassified');
    const groups = [...names].map(([id,name])=>({id,name,list:scoped.filter(c=>String(c.department_id ?? 'unmapped')===id)})).sort((a,b)=>a.name.localeCompare(b.name));
    const total = instituteApplicationCounts(scoped);
    const headers = ['Department', 'Applications Received', 'Complete', 'Incomplete', 'Other / Unspecified Form Status', 'Full Time', 'Part Time (Total)', 'Part Time External', 'External Academic', 'External Industry', 'Part Time Internal', 'Other Part Time', 'Other / Unspecified Mode'];
    const values = (name,c) => [name,c.received,c.complete,c.incomplete,c.otherStatus,c.fullTime,c.partTime,c.external,c.academic,c.industry,c.internal,c.otherPartTime,c.otherMode];
    const summary = [
        ['INSTITUTE APPLICATIONS — CONSOLIDATED REPORT'],
        ['Institute', institute.name], ['Campus', institute.campus_name || ''],
        ['Generated', new Date().toLocaleString('en-IN', {timeZone:'Asia/Kolkata'})],
        ['Applications Received', total.received], ['Complete Applications', total.complete], ['Incomplete Applications', total.incomplete], ['Other / Unspecified Form Status', total.otherStatus], ['Report scope', institute.scope_note || 'All applications available to your account for this institute.'],
        ['Part Time External and Internal are subsets of Part Time (Total); do not add them again to the total.'],
        ['Full Time + Part Time (Total) + Other / Unspecified Mode = Applications Received.'],
        ['Completion counts use the original Form Status, independently of eligibility or selection.'], [], headers,
        ...groups.map(g=>values(g.name,instituteApplicationCounts(g.list))), values('INSTITUTE TOTAL',total)
    ];
    const summarySheet = XLSXLib.utils.aoa_to_sheet(summary);
    summarySheet['!cols'] = [{wch:45},...Array.from({length:12},()=>({wch:22}))];
    summarySheet['!merges'] = [0,9,10,11].map(r=>({s:{r,c:0},e:{r,c:12}}));
    summarySheet['!autofilter'] = {ref:'A14:M'+(14+groups.length)};
    XLSXLib.utils.book_append_sheet(workbook,summarySheet,'Summary');
    const used = new Set(['summary']);
    for (const group of groups) {
        let base = String(group.name).replace(/[\[\]\*?\/\\:]/g,' ').replace(/^'+|'+$/g,'').trim() || 'Department';
        let name = base.slice(0,31),index=2;
        while (used.has(name.toLowerCase())) {const suffix=' ('+index+++')';name=base.slice(0,31-suffix.length)+suffix;}
        used.add(name.toLowerCase());
        const rows = group.list.slice().sort((a,b)=>String(a.mode_of_study || '').localeCompare(String(b.mode_of_study || '')) || String(a.application_no).localeCompare(String(b.application_no),undefined,{numeric:true})).map((c,i)=>({
            'S.No':i+1, 'Application No':String(c.application_no || ''), 'Registered Name':c.registered_name || '', 'Institute':institute.name, 'Department':group.name, 'Mode Of Study':c.mode_of_study || '', 'Form Status':c.form_status || '', 'Program':c.program || '', 'Email':c.email || '', 'Mobile':String(c.mobile || ''), 'Category':c.category || '', 'Workflow Status':c.status || '', 'Current Owner':c.current_owner || '', 'Exam Attendance':c.exam_attendance || '', 'Written Marks':c.written_marks ?? '', 'Interview Average':c.avg_interview_marks ?? '', 'Total Marks':c.total_marks ?? '', 'Rank':c.rank ?? '', 'Selection Status':c.selection_status || '', 'Supervisor':c.supervisor_name || ''
        }));
        const columns = ['S.No','Application No','Registered Name','Institute','Department','Mode Of Study','Form Status','Program','Email','Mobile','Category','Workflow Status','Current Owner','Exam Attendance','Written Marks','Interview Average','Total Marks','Rank','Selection Status','Supervisor'];
        const sheet = XLSXLib.utils.json_to_sheet(rows,{header:columns});
        sheet['!cols'] = columns.map(c=>({wch:c==='Program'?70:['Institute','Department','Registered Name','Email','Supervisor'].includes(c)?36:22}));
        sheet['!autofilter']={ref:'A1:T'+Math.max(1,rows.length+1)};
        XLSXLib.utils.book_append_sheet(workbook,sheet,name);
    }
    return workbook;
}
async function openInstituteApplicationsExport(preselectedId = null) {
    const escape = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    try {
        const [candidateResult,metadata] = await Promise.all([api('/api/candidates'),api('/api/admin/metadata')]);
        const candidates = candidateResult.candidates || [];
        let institutes = (metadata.institutions || []).filter(i => !i.is_routing_office);
        const user=state.user;
        if (user.role==='admin') institutes=institutes.filter(i=>Number(i.campus_id)===Number(user.campus_id));
        else if (user.role==='coordinator') institutes=institutes.filter(i=>i.coord_username===user.username && Number(i.campus_id)===Number(user.campus_id));
        else if (user.role==='dean') institutes=institutes.filter(i=>i.dean_username===user.username && Number(i.campus_id)===Number(user.campus_id));
        else if (user.role==='hod') institutes=institutes.filter(i=>Number(i.id)===Number(user.institution_id));
        if (!institutes.length) return showToast('No institutes are available for export.','error');
        document.getElementById('institute-export-modal')?.remove();
        const modal=document.createElement('div');modal.className='modal-overlay';modal.id='institute-export-modal';
        modal.innerHTML=`<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="institute-export-title" style="width:90%;max-width:650px;padding:24px;box-sizing:border-box;max-height:90vh;overflow:auto;"><h3 id="institute-export-title" style="margin-bottom:12px;">Institute-wise Excel Report</h3><p style="margin:12px 0;line-height:1.5;">Includes all application statuses and study modes, with a summary followed by a sheet for each department. ${user.role==='hod'?'Includes only the applicants available to your HoD account.':''}</p><label for="institute-export-choice">Institute</label><select id="institute-export-choice" class="form-control">${institutes.map(i=>{const campus=(metadata.campuses || []).find(c=>Number(c.id)===Number(i.campus_id));return `<option value="${Number(i.id)}" ${Number(preselectedId)===Number(i.id)?'selected':''}>${escape(i.name)} — ${escape(campus?.name || '')}</option>`}).join('')}</select><p id="institute-export-counts" style="margin:16px 0;"></p><div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" id="institute-export-download" class="btn btn-success"><i class="fa-solid fa-file-excel"></i> Download Institute Excel</button><button type="button" id="institute-export-cancel" class="btn btn-secondary">Cancel</button></div></div>`;
        document.body.appendChild(modal);
        const select=modal.querySelector('select');
        const update=()=>{const counts=instituteApplicationCounts(candidates.filter(c=>Number(c.institution_id)===Number(select.value)));modal.querySelector('#institute-export-counts').textContent='Applications received: '+counts.received+' | Complete: '+counts.complete+' | Incomplete: '+counts.incomplete+(counts.otherStatus?' | Other/unspecified: '+counts.otherStatus:'');};
        select.onchange=update;update();select.focus();
        modal.querySelector('#institute-export-cancel').onclick=()=>modal.remove();
        modal.querySelector('#institute-export-download').onclick=()=>{
            const button=modal.querySelector('#institute-export-download');button.disabled=true;
            try {
                if (typeof XLSX==='undefined') throw new Error('Excel export is unavailable. Reload the page and try again.');
                const institute=institutes.find(i=>Number(i.id)===Number(select.value));
                const campus=(metadata.campuses || []).find(c=>Number(c.id)===Number(institute.campus_id));
                const workbook=buildInstituteApplicationsWorkbook(candidates,{...institute,campus_name:campus?.name || '',scope_note:user.role==='hod'?'Only applicants available to this HoD account; this is not the full institute population.':'All applications available to your account for this institute.'},metadata.departments || []);
                const filename=(institute.name+'_'+(campus?.name || '')).replace(/[^a-z0-9_-]/gi,'_').slice(0,130)+'_Applications_'+new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})+'.xlsx';
                XLSX.writeFile(workbook,filename);modal.remove();showToast('Institute report downloaded.');
            }catch(error){showToast(error.message,'error');button.disabled=false;}
        };
    }catch(error){showToast(error.message,'error');}
}
function renderInstituteApplicationsExportCard() {
    return '<div class="card" style="margin:1.5rem 0;"><h3><i class="fa-solid fa-file-excel"></i> Institute-wise Applications Report</h3><p>Download an institute summary with complete/incomplete totals, study-mode counts and department-wise applicant sheets.</p><button type="button" class="btn btn-success" onclick="openInstituteApplicationsExport()">Download Institute Excel</button></div>';
}
