'use strict';
const {isFullTimeWithFellowship}=require('../public/js/modules/study_mode_policy');
module.exports = function registerSelectionWorkflow({app,db,dbPath,sqlite3,requireAuth,logAudit,io}) {
    const fail=(status,message)=>Object.assign(new Error(message),{status});
    const all=(cx,sql,args=[])=>new Promise((resolve,reject)=>cx.all(sql,args,(error,rows)=>error?reject(error):resolve(rows)));
    const one=async(cx,sql,args=[])=>(await all(cx,sql,args))[0];
    const run=(cx,sql,args=[])=>new Promise((resolve,reject)=>cx.run(sql,args,function(error){error?reject(error):resolve({id:this.lastID,changes:this.changes});}));
    const id=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw fail(400,'A valid record ID is required.');return n;};
    const note=value=>{if(value==null)return '';if(typeof value!=='string'||value.length>4000)throw fail(400,'Keep remarks within 4000 characters.');return value.trim();};
    const handle=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){const status=error.status||(error.code==='SQLITE_BUSY'?409:500);if(status===500)console.error('Selection workflow:',error.message);res.status(status).json({error:error.status?error.message:status===409?'Another update is in progress. Refresh and retry.':'The change could not be saved. No changes were applied.'});}};
    async function transaction(fn) {
        const cx=new sqlite3.Database(dbPath);cx.configure('busyTimeout',5000);let begun=false;
        try {await run(cx,'PRAGMA foreign_keys=ON');await run(cx,'BEGIN IMMEDIATE');begun=true;const result=await fn(cx);await run(cx,'COMMIT');begun=false;return result;}
        catch(error){if(begun)try{await run(cx,'ROLLBACK');}catch{}throw error;}
        finally{await new Promise(resolve=>cx.close(resolve));}
    }
    const guideStages=['Guide Allocation Open','Guide Allocated','Returned to HOD (Guides)'];
    const releasedStages=[...guideStages,'Selection Finalized','Under Dean Final Review','Returned to RC (Guides)','Returned to Dean (Final)','Approved Guides'];
    const released=c=>!!c.ranks_released_at||releasedStages.includes(c.status);
    const normalizeName=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/^\s*dr\.?\s*/,'').replace(/[^\p{L}\p{N}]/gu,'');
    const panelEligible=c=>c&&String(c.form_status||'').toLowerCase()!=='incomplete'&&!['Selected','Not Selected'].includes(c.selection_status)&&(['HOD Verified Eligible','Verified Eligible','Eligible','Entrance Exam Attended','Marks Entered'].includes(c.status)||c.status_reason==='Eligible'&&['Under RC Review','Under Dean Review','Returned to RC','Returned to Dean'].includes(c.status));
    function visibleCandidate(user,c) {
        const visible=['admin','super_admin'].includes(user.role)||released(c);
        if(visible)return {...c,ranks_released:released(c)};
        const result={...c,ranks_released:false};
        for(const key of ['rank','written_marks','scaled_written_marks','avg_interview_marks','total_marks','interview_marks_1','interview_marks_2','interview_marks_3','interview_marks_4','interview_marks_5'])result[key]=null;
        return result;
    }
    async function ownedCandidate(cx,req,candidateId) {
        const c=await one(cx,'SELECT * FROM candidates WHERE id=? AND campus_id=? AND institution_id=? AND department_id=?',[id(candidateId),req.user.campus_id,req.user.institution_id,req.user.department_id]);
        if(!c)throw fail(404,'Candidate not found in your department.');return c;
    }
    function assertSelectionOpen(c) {
        if(c.current_owner!=='HOD'||!guideStages.includes(c.status)||!released(c)||!(Number(c.rank)>0))throw fail(409,'Admin must release the ranks before HoD selection. This application must be awaiting your guide-allocation action.');
    }
    async function assertCapacity(cx,c) {
        if(!isFullTimeWithFellowship(c))return;
        const dept=await one(cx,'SELECT ft_allowed FROM departments WHERE id=?',[c.department_id]);
        if(dept?.ft_allowed==null)throw fail(409,'The Super Admin has not set the full-time with fellowship allotment for this department.');
        const selected=await all(cx,"SELECT mode_of_study,program FROM candidates WHERE campus_id=? AND institution_id=? AND department_id=? AND id<>? AND selection_status='Selected'",[c.campus_id,c.institution_id,c.department_id,c.id]);
        const used=selected.filter(isFullTimeWithFellowship).length;
        if(used>=dept.ft_allowed)throw fail(409,`The department full-time with fellowship allotment of ${dept.ft_allowed} is filled. The Super Admin must increase it before another full-time with fellowship applicant can be selected.`);
    }
    async function syncSupervisorCounts(cx,c) {
        await run(cx,`UPDATE supervisors SET allocated_count=(SELECT COUNT(*) FROM candidates c WHERE c.campus_id=supervisors.campus_id AND c.department_id=supervisors.department_id AND TRIM(c.supervisor_name)=TRIM(supervisors.name) COLLATE NOCASE AND c.selection_status='Selected') WHERE campus_id=? AND department_id=?`,[c.campus_id,c.department_id]);
    }
    const updated=(type,extra={})=>io.emit('admissions_updated',{type,...extra});
    const release=handle(async(req,res)=>{
        const body=req.body||{},candidateIds=body.candidateIds==null?null:body.candidateIds;
        if(candidateIds!==null&&(!Array.isArray(candidateIds)||!candidateIds.length))throw fail(400,'Select at least one ranked application.');
        const ids=candidateIds?[...new Set(candidateIds.map(id))]:null;
        const department=body.department_id==null?null:id(body.department_id);
        const campus=req.user.role==='super_admin'?id(body.campus_id||req.user.campus_id):req.user.campus_id;
        const count=await transaction(async cx=>{
            let where='campus_id=?',args=[campus];
            if(department){where+=' AND department_id=?';args.push(department);}
            if(ids){where+=' AND id IN ('+ids.map(()=>'?').join(',')+')';args.push(...ids);}
            const rows=await all(cx,'SELECT * FROM candidates WHERE '+where,args);
            if(ids&&rows.length!==ids.length)throw fail(403,'One or more applicants are outside the selected campus or department.');
            const ready=rows.filter(c=>Number(c.rank)>0&&c.total_marks!=null&&['Ranked','Under Dean Review (Ranks)','Under RC Review (Ranks)','Ranks Released'].includes(c.status));
            if(!ready.length)throw fail(409,'No generated ranks are awaiting release in this selection.');
            for(const c of ready)await run(cx,"UPDATE candidates SET status='Guide Allocation Open',current_owner='HOD',ranks_released_at=CURRENT_TIMESTAMP,return_remark=NULL WHERE id=?",[c.id]);
            return ready.length;
        });
        logAudit(req,'RANKS_RELEASED_TO_ALL',`Released ${count} ranked applications to all relevant users; guide allocation opened for HoDs.`);
        updated('ranks',{campus_id:campus});res.json({success:true,released_count:count,message:`Released ${count} ranks to all relevant users. HoDs can now select applicants and assign supervisors.`});
    });
    for(const route of ['/api/admin/release-ranks-to-all','/api/admin/forward-ranked-to-dean','/api/admin/forward-ranks'])app.post(route,requireAuth(['admin','super_admin']),release);
    for(const [route,role] of [['/api/dean/forward-ranks-to-rc','dean'],['/api/rc/forward-ranks-to-hod','coordinator'],['/api/coordinator/forward-ranks-to-hod','coordinator']])app.post(route,requireAuth([role]),(req,res)=>res.json({success:true,changed:0,message:'Admin now releases ranks directly to all users. No Dean or RC rank-release step is required.'}));
    app.post('/api/hod/candidates/:id/assign-panel',requireAuth(['hod']),handle(async(req,res)=>{
        const panelId=req.body.panel_id==null||req.body.panel_id===''?null:id(req.body.panel_id);
        await transaction(async cx=>{
            const c=await ownedCandidate(cx,req,req.params.id);if(!panelEligible(c))throw fail(409,'Interview panels can be allotted only to eligible applicants.');
            const deadline=await one(cx,"SELECT value FROM settings WHERE key='deadline_allocate_panels'");
            if(deadline?.value){const today=new Date(),last=new Date(deadline.value);today.setHours(0,0,0,0);last.setHours(0,0,0,0);if(today>last)throw fail(403,'The panel allocation deadline has passed.');}
            if(panelId&&!await one(cx,'SELECT id FROM interview_panels WHERE id=? AND campus_id=? AND institution_id=? AND department_id=?',[panelId,c.campus_id,c.institution_id,c.department_id]))throw fail(400,'Choose an interview panel from this department.');
            await run(cx,'UPDATE candidates SET panel_id=? WHERE id=?',[panelId,c.id]);
        });
        logAudit(req,'INTERVIEW_PANEL_ASSIGNED','Updated interview panel for eligible applicant '+req.params.id,req.params.id);res.json({success:true,message:'Interview panel saved for the eligible applicant.'});
    }));
    app.post('/api/hod/candidates/:id/selection',requireAuth(['hod']),handle(async(req,res)=>{
        const selection=req.body.selection_status;if(!['Selected','Not Selected'].includes(selection))throw fail(400,'Choose Selected or Not Selected.');
        let scope;
        await transaction(async cx=>{
            const c=await ownedCandidate(cx,req,req.params.id);scope=c;assertSelectionOpen(c);
            if(selection==='Selected'&&c.selection_status!=='Selected')await assertCapacity(cx,c);
            if(selection==='Not Selected'){
                await run(cx,"UPDATE candidates SET selection_status='Not Selected',supervisor_name=NULL,supervisor_designation=NULL,supervisor_affiliation=NULL,status='Guide Allocation Open',allocation_remark=NULL WHERE id=?",[c.id]);
                await syncSupervisorCounts(cx,c);
            }else await run(cx,"UPDATE candidates SET selection_status='Selected' WHERE id=?",[c.id]);
        });
        logAudit(req,'HOD_SELECTION_CHANGED',`Applicant ${req.params.id} marked ${selection}.`,req.params.id);updated('selection',{campus_id:scope.campus_id,department_id:scope.department_id});res.json({success:true,message:'Candidate marked '+selection+'.'});
    }));
    app.post('/api/hod/assign-supervisor',requireAuth(['hod']),handle(async(req,res)=>{
        if(req.body.selection_status&&req.body.selection_status!=='Selected')throw fail(400,'Use the selection-status action to mark an applicant Not Selected.');
        const remark=note(req.body.allocation_remark);let scope;
        await transaction(async cx=>{
            const c=await ownedCandidate(cx,req,req.body.candidate_id);scope=c;assertSelectionOpen(c);
            if(c.selection_status!=='Selected')await assertCapacity(cx,c);
            let supervisor=null,name=note(req.body.supervisor_name),designation=note(req.body.supervisor_designation),affiliation=note(req.body.supervisor_affiliation);
            const directory=await all(cx,'SELECT * FROM supervisors WHERE campus_id=? AND department_id=?',[c.campus_id,c.department_id]);
            if(req.body.supervisor_id){supervisor=directory.find(s=>s.id===id(req.body.supervisor_id));if(!supervisor)throw fail(404,'Supervisor not found in this department.');}
            else supervisor=directory.find(s=>normalizeName(s.name)===normalizeName(name));
            if(supervisor){name=supervisor.name;designation=supervisor.designation;affiliation=supervisor.faculty||'SRMIST';if(supervisor.is_eligible!=='Yes')throw fail(409,'This supervisor is not eligible for allocation.');}
            if(!name)throw fail(400,'Supervisor name is required.');
            const first=normalizeName(c.preference_1),second=normalizeName(c.preference_2),assigned=normalizeName(name);
            if((first&&assigned!==first||!first&&second&&assigned!==second)&&!remark)throw fail(400,'An allocation remark is required when the first preferred supervisor is not assigned. Explain why the preferred supervisor could not be allotted.');
            const assignedRows=await all(cx,"SELECT supervisor_name FROM candidates WHERE id<>? AND selection_status='Selected' AND supervisor_name IS NOT NULL",[c.id]);
            const allocated=assignedRows.filter(r=>normalizeName(r.supervisor_name)===assigned).length;
            const capacity=supervisor?Math.max(0,Math.min(2,Number(supervisor.vacancy??8),Number(supervisor.max_students??8)-Number(supervisor.current_guiding??0))):2;
            if(allocated>=capacity)throw fail(409,'The supervisor has no available session vacancy. Choose another supervisor and record the reason when required.');
            await run(cx,"UPDATE candidates SET supervisor_name=?,supervisor_designation=?,supervisor_affiliation=?,selection_status='Selected',status='Guide Allocated',allocation_remark=? WHERE id=?",[name,designation||null,affiliation||null,remark||null,c.id]);
            await syncSupervisorCounts(cx,c);
        });
        logAudit(req,'SUPERVISOR_ALLOCATED','Assigned supervisor with selection and preference validation for applicant '+req.body.candidate_id,req.body.candidate_id);updated('selection',{campus_id:scope.campus_id,department_id:scope.department_id});res.json({success:true,message:'Supervisor allocated and candidate selected.'});
    }));
    return {visibleCandidate,panelEligible,released,updated};
};
