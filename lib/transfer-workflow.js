'use strict';
// Transfer data and remarks are committed together on a dedicated connection.
module.exports = function registerTransferWorkflow({app,db,dbPath,sqlite3,requireAuth,logAudit,resolveAdmissionMapping}) {
    const roles=['hod','coordinator','dean','admin','super_admin'];
    const active = stage => !['COMPLETED','ADMIN_REJECTED'].includes(stage);
    const failure=(status,message)=>Object.assign(new Error(message),{status});
    const id = value => {const number=Number(value);if(!Number.isSafeInteger(number)||number<1)throw failure(400,'A valid record ID is required.');return number;};
    const text=(value,required=false)=>{if(value==null&&!required)return '';if(typeof value!=='string'||(required&&!value.trim()))throw failure(400,'A reason or remark is required.');if(value.length>4000)throw failure(400,'Please keep remarks within 4000 characters.');return value.trim();};
    const query=(connection,sql,params=[])=>new Promise((resolve,reject)=>connection.all(sql,params,(e,rows)=>e?reject(e):resolve(rows)));
    const first=async(connection,sql,params=[]) => (await query(connection,sql,params))[0];
    const run=(connection,sql,params=[])=>new Promise((resolve,reject)=>connection.run(sql,params,function(e){e?reject(e):resolve({id:this.lastID,changes:this.changes});}));
    const handle=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){const conflict=error.code==='SQLITE_BUSY'||error.code==='SQLITE_CONSTRAINT'&&error.message.includes('transfer_requests.candidate_id');const status=error.status||(conflict?409:500);if(status===500)console.error('Transfer operation failed:',error.message);res.status(status).json({error:error.status?error.message:conflict?'This application is already being updated or transferred. Refresh and retry.':'The transfer could not be saved. No changes were applied. Please retry.'});}};
    async function transaction(fn) {
        const connection=new sqlite3.Database(dbPath);connection.configure('busyTimeout',5000);
        let begun=false;
        try {await run(connection,'PRAGMA foreign_keys=ON');await run(connection,'BEGIN IMMEDIATE');begun=true;const result=await fn(connection);await run(connection,'COMMIT');begun=false;return result;}
        catch(error){if(begun)try{await run(connection,'ROLLBACK');}catch{}throw error;}
        finally{await new Promise(resolve=>connection.close(resolve));}
    }
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_one_active ON transfer_requests(candidate_id) WHERE stage NOT IN ('COMPLETED','ADMIN_REJECTED')",error=>{if(error)console.error('Transfer uniqueness migration:',error.message);});
    const select=`SELECT tr.*,c.application_no,c.registered_name,c.email,c.mobile,c.mode_of_study,c.status candidate_status,c.current_owner candidate_owner,
      fi.name from_inst_name,fd.name from_dept_name,ti.name to_inst_name,td.name to_dept_name,
      fi.campus_id from_campus_id,ti.campus_id to_campus_id,fi.coord_username from_coord_username,fi.dean_username from_dean_username,
      ti.coord_username to_coord_username,ti.dean_username to_dean_username
      FROM transfer_requests tr JOIN candidates c ON c.id=tr.candidate_id
      LEFT JOIN institutions fi ON fi.id=tr.from_institution_id LEFT JOIN departments fd ON fd.id=tr.from_department_id
      LEFT JOIN institutions ti ON ti.id=tr.to_institution_id LEFT JOIN departments td ON td.id=tr.to_department_id`;
    const sameHod=(user,tr,side)=>Number(user.campus_id)===Number(tr[side+'_campus_id'])&&Number(user.institution_id)===Number(tr[side+'_institution_id'])&&Number(user.department_id)===Number(tr[side+'_department_id']);
    function participant(user,tr) {
        if(user.role==='super_admin')return true;
        if(user.role==='admin')return [Number(tr.from_campus_id),Number(tr.to_campus_id)].includes(Number(user.campus_id));
        if(user.role==='hod')return sameHod(user,tr,'from')||sameHod(user,tr,'to')||tr.requested_by===user.username;
        const key=user.role==='dean'?'dean_username':user.role==='coordinator'?'coord_username':null;
        return !!key && (Number(user.campus_id)===Number(tr.from_campus_id)&&tr['from_'+key]===user.username||Number(user.campus_id)===Number(tr.to_campus_id)&&tr['to_'+key]===user.username);
    }
    function actionable(user,tr) {
        if(!active(tr.stage))return false;
        if(user.role==='hod')return tr.stage==='TARGET_HOD'&&sameHod(user,tr,'to');
        if(user.role==='admin'||user.role==='super_admin')return tr.stage==='REJECTED_ADMIN'&&(user.role==='super_admin'||Number(user.campus_id)===Number(tr.to_campus_id));
        if(user.role==='coordinator')return tr.stage==='ORIG_RC'&&Number(user.campus_id)===Number(tr.from_campus_id)&&tr.from_coord_username===user.username||['TARGET_RC','REJECTED_RC'].includes(tr.stage)&&Number(user.campus_id)===Number(tr.to_campus_id)&&tr.to_coord_username===user.username;
        if(user.role==='dean')return tr.stage==='ORIG_DEAN'&&Number(user.campus_id)===Number(tr.from_campus_id)&&tr.from_dean_username===user.username||['TARGET_DEAN','REJECTED_DEAN'].includes(tr.stage)&&Number(user.campus_id)===Number(tr.to_campus_id)&&tr.to_dean_username===user.username;
        return false;
    }
    async function list(user) {
        const rows=await query(db,select+' ORDER BY tr.id DESC');
        const history=await query(db,'SELECT DISTINCT transfer_id FROM transfer_remarks WHERE actor_username=?',[user.username]);
        const participated=new Set(history.map(r=>r.transfer_id));
        return rows.filter(tr=>participant(user,tr)||participated.has(tr.id)).map(tr=>({...tr,is_actionable:actionable(user,tr),is_incoming:user.role==='hod'&&sameHod(user,tr,'to'),is_outgoing:user.role==='hod'&&(sameHod(user,tr,'from')||tr.requested_by===user.username)}));
    }
    async function destinations(connection) {
        const rows=await query(connection,`SELECT d.id dept_id,d.name dept_name,i.id inst_id,i.name inst_name,i.campus_id FROM departments d JOIN institutions i ON i.id=d.institution_id
          WHERE i.id IN(1,2,3,4,5,6,7,9)
          AND EXISTS(SELECT 1 FROM users u WHERE u.username=i.dean_username AND u.role='dean' AND u.campus_id=i.campus_id)
          AND EXISTS(SELECT 1 FROM users u WHERE u.username=i.coord_username AND u.role='coordinator' AND u.campus_id=i.campus_id)
          AND EXISTS(SELECT 1 FROM users u WHERE u.role='hod' AND u.campus_id=i.campus_id AND u.institution_id=i.id AND u.department_id=d.id)
          ORDER BY i.campus_id,i.name,d.name`);
        return rows.filter(r=>resolveAdmissionMapping(r.inst_name,r.dept_name,r.campus_id,rows).match);
    }
    async function destination(connection,instituteId,departmentId) {
        const institute=id(instituteId),department=id(departmentId);
        const match=(await destinations(connection)).find(d=>d.inst_id===institute&&d.dept_id===department);
        if(!match)throw failure(400,'Choose a configured department under the selected institute with an assigned Dean, RC and HoD.');
        return match;
    }
    async function getTransfer(connection,transferId,user) {
        const tr=await first(connection,select+' WHERE tr.id=?',[id(transferId)]);
        if(!tr)throw failure(404,'Transfer request not found.');
        if(!participant(user,tr))throw failure(403,'You are not assigned to this transfer.');
        if(!actionable(user,tr))throw failure(409,'This transfer is no longer awaiting your action. Refresh the page.');
        const candidate=await first(connection,'SELECT * FROM candidates WHERE id=?',[tr.candidate_id]);
        const expected=tr.stage==='TARGET_HOD'?'HOD':tr.stage==='REJECTED_ADMIN'?'Admin':tr.stage.includes('DEAN')?'Dean':'RC';
        if(candidate.status!=='Transfer in Progress'||!(expected==='RC'?['RC','Coordinator'].includes(candidate.current_owner):candidate.current_owner===expected))throw failure(409,'The application workflow has changed. Refresh before continuing.');
        if(Number(candidate.institution_id)!==Number(tr.from_institution_id)||Number(candidate.department_id)!==Number(tr.from_department_id)||Number(candidate.campus_id)!==Number(tr.from_campus_id))throw failure(409,'The application location has changed. This transfer needs review.');
        return tr;
    }
    const remark=(connection,tr,user,action,remarks)=>run(connection,'INSERT INTO transfer_remarks(transfer_id,stage,actor_username,actor_name,actor_role,action,remarks) VALUES(?,?,?,?,?,?,?)',[tr.id,tr.stage,user.username,user.name||user.username,user.role,action,remarks]);
    async function setStage(connection,tr,stage,status='In Progress') {
        const result=await run(connection,'UPDATE transfer_requests SET stage=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND stage=?',[stage,status,tr.id,tr.stage]);
        if(result.changes!==1)throw failure(409,'The transfer was already updated. Refresh the page.');
    }
    app.get('/api/transfers/destinations',requireAuth(roles),handle(async(req,res)=>{
        const rows=await destinations(db),campuses=await query(db,'SELECT id,name FROM campuses ORDER BY id');
        res.json({campuses,institutions:[...new Map(rows.map(r=>[r.inst_id,{id:r.inst_id,name:r.inst_name,campus_id:r.campus_id}])).values()],departments:rows.map(r=>({id:r.dept_id,name:r.dept_name,institution_id:r.inst_id}))});
    }));
    app.post('/api/candidates/transfer',requireAuth(['hod']),handle(async(req,res)=>{
        const candidateId=id(req.body.candidate_id),reason=text(req.body.reason,true);
        const transferId=await transaction(async connection=>{
            const c=await first(connection,'SELECT * FROM candidates WHERE id=? AND campus_id=? AND institution_id=? AND department_id=?',[candidateId,req.user.campus_id,req.user.institution_id,req.user.department_id]);
            if(!c)throw failure(404,'Candidate not found in your department.');
            const pending=await first(connection,"SELECT id FROM transfer_requests WHERE candidate_id=? AND stage NOT IN('COMPLETED','ADMIN_REJECTED')",[candidateId]);
            if(pending)throw failure(409,'An active transfer already exists for this applicant.');
            const allowed=['Under HOD Verification','Returned to HOD','Complete','Pending Verification','HOD Verified Eligible','HOD Verified Ineligible'];
            if(c.current_owner!=='HOD'||!allowed.includes(c.status)||['rank','total_marks','written_marks','avg_interview_marks','scaled_written_marks','interview_marks_1','interview_marks_2','interview_marks_3','interview_marks_4','interview_marks_5'].some(key=>c[key]!=null)||!['','Pending Selection'].includes(c.selection_status||'')||c.supervisor_name)throw failure(409,'Only applications awaiting HoD eligibility review can be transferred. Processed selections or ranked applications cannot be transferred.');
            const target=await destination(connection,req.body.to_institution_id,req.body.to_department_id);
            await destination(connection,c.institution_id,c.department_id);
            if(target.dept_id===c.department_id)throw failure(400,'Target department cannot be the current department.');
            const inserted=await run(connection,"INSERT INTO transfer_requests(candidate_id,from_institution_id,from_department_id,to_institution_id,to_department_id,requested_by,stage,status,initial_reason,updated_at) VALUES(?,?,?,?,?,?,'ORIG_RC','In Progress',?,CURRENT_TIMESTAMP)",[candidateId,c.institution_id,c.department_id,target.inst_id,target.dept_id,req.user.username,reason]);
            await remark(connection,{id:inserted.id,stage:'INITIATED'},req.user,'Transfer Initiated',reason);
            await run(connection,"UPDATE candidates SET status='Transfer in Progress',current_owner='RC',status_reason=? WHERE id=?",['Transfer requested: '+reason,candidateId]);
            return inserted.id;
        });
        logAudit(req,'TRANSFER_INITIATED','Transfer requested for candidate '+candidateId,transferId);
        res.json({success:true,message:'Transfer request routed to the originating Research Coordinator.',transfer_id:transferId});
    }));
    app.get('/api/transfers/my-requests',requireAuth(roles),handle(async(req,res)=>res.json({requests:await list(req.user)})));
    app.get('/api/transfers/pending-counts',requireAuth(roles),handle(async(req,res)=>res.json({count:(await list(req.user)).filter(tr=>tr.is_actionable).length})));
    app.get('/api/transfers/:id/remarks',requireAuth(roles),handle(async(req,res)=>{
        const transferId=id(req.params.id);
        if(!(await list(req.user)).some(tr=>tr.id===transferId))throw failure(403,'You are not assigned to this transfer.');
        res.json({remarks:await query(db,'SELECT * FROM transfer_remarks WHERE transfer_id=? ORDER BY id',[transferId])});
    }));
    app.post('/api/transfers/:id/forward',requireAuth(['coordinator','dean']),handle(async(req,res)=>{
        const note=text(req.body.remarks);
        await transaction(async connection=>{
            const tr=await getTransfer(connection,req.params.id,req.user);
            await destination(connection,tr.to_institution_id,tr.to_department_id);
            const next={ORIG_RC:['ORIG_DEAN','Dean','Forwarded to Originating Dean'],ORIG_DEAN:[tr.from_institution_id===tr.to_institution_id?'TARGET_HOD':'TARGET_DEAN',tr.from_institution_id===tr.to_institution_id?'HOD':'Dean','Forwarded to Receiving '+(tr.from_institution_id===tr.to_institution_id?'HoD':'Dean')],TARGET_DEAN:['TARGET_RC','RC','Forwarded to Receiving RC'],TARGET_RC:['TARGET_HOD','HOD','Forwarded to Receiving HoD'],REJECTED_RC:['REJECTED_DEAN','Dean','Rejection forwarded to Receiving Dean'],REJECTED_DEAN:['REJECTED_ADMIN','Admin','Rejection escalated to Receiving Campus Admin']}[tr.stage];
            if(!next)throw failure(409,'This stage cannot be forwarded.');
            await setStage(connection,tr,next[0],tr.stage.startsWith('REJECTED_')?'Rejected by Target HOD':'In Progress');
            await remark(connection,tr,req.user,next[2],note||next[2]);
            await run(connection,'UPDATE candidates SET current_owner=? WHERE id=?',[next[1],tr.candidate_id]);
        });
        logAudit(req,'TRANSFER_FORWARDED','Forwarded transfer '+req.params.id,req.params.id);
        res.json({success:true,message:'Transfer forwarded successfully.'});
    }));
    app.post('/api/transfers/:id/target-hod-decision',requireAuth(['hod']),handle(async(req,res)=>{
        const action=req.body.action;if(!['Accept','Reject'].includes(action))throw failure(400,'Choose Accept or Reject.');
        const note=text(req.body.reason,action==='Reject')||(action==='Accept'?'Accepted into receiving department.':'');
        await transaction(async connection=>{
            const tr=await getTransfer(connection,req.params.id,req.user),target=await destination(connection,tr.to_institution_id,tr.to_department_id);
            if(action==='Accept') {
                await setStage(connection,tr,'COMPLETED','Accepted');
                await run(connection,"UPDATE transfer_requests SET target_hod_decision='Accepted',target_hod_reason=? WHERE id=?",[note,tr.id]);
                await run(connection,"UPDATE candidates SET campus_id=?,institution_id=?,department_id=?,status='Under HOD Verification',current_owner='HOD',status_reason=?,panel_id=NULL WHERE id=?",[target.campus_id,target.inst_id,target.dept_id,'Transferred and accepted: '+note,tr.candidate_id]);
            } else {
                await setStage(connection,tr,'REJECTED_RC','Rejected by Target HOD');
                await run(connection,"UPDATE transfer_requests SET target_hod_decision='Rejected',target_hod_reason=? WHERE id=?",[note,tr.id]);
                await run(connection,"UPDATE candidates SET current_owner='RC',status_reason=? WHERE id=?",['Transfer rejected by receiving HoD: '+note,tr.candidate_id]);
            }
            await remark(connection,tr,req.user,action==='Accept'?'Accepted by Target HOD':'Rejected by Target HOD',note);
        });
        logAudit(req,action==='Accept'?'TRANSFER_ACCEPTED':'TRANSFER_REJECTED','Transfer '+req.params.id+' '+action.toLowerCase()+'ed by receiving HoD',req.params.id);
        res.json({success:true,message:action==='Accept'?'Candidate transferred and added to your eligibility verification queue.':'Rejection routed to the receiving RC.'});
    }));
    app.post('/api/transfers/:id/admin-decision',requireAuth(['admin','super_admin']),handle(async(req,res)=>{
        const action=req.body.action;if(!['Reassign','Reject'].includes(action))throw failure(400,'Choose Reassign or Reject.');
        const note=text(req.body.reason,action==='Reject')||'Reassigned by Admin for receiving HoD review.';
        await transaction(async connection=>{
            const tr=await getTransfer(connection,req.params.id,req.user);
            if(action==='Reassign') {
                const target=await destination(connection,req.body.new_institution_id,req.body.new_department_id);
                await setStage(connection,tr,'TARGET_HOD');
                await run(connection,"UPDATE transfer_requests SET to_institution_id=?,to_department_id=?,admin_action='Reassigned',admin_reason=?,target_hod_decision=NULL,target_hod_reason=NULL WHERE id=?",[target.inst_id,target.dept_id,note,tr.id]);
                // Physical campus/department change is deferred until the new HoD accepts.
                await run(connection,"UPDATE candidates SET current_owner='HOD',status_reason=? WHERE id=?",['Reassignment awaiting receiving HoD acceptance: '+note,tr.candidate_id]);
            } else {
                await setStage(connection,tr,'ADMIN_REJECTED','Rejected by Admin');
                await run(connection,"UPDATE transfer_requests SET admin_action='Rejected',admin_reason=? WHERE id=?",[note,tr.id]);
                await run(connection,"UPDATE candidates SET status='Not Selected',selection_status='Not Selected',current_owner='Admin',status_reason=? WHERE id=?",[note,tr.candidate_id]);
            }
            await remark(connection,tr,req.user,action==='Reassign'?'Reassigned by Admin':'Candidate Not Selected by Admin',note);
        });
        logAudit(req,action==='Reassign'?'TRANSFER_REASSIGNED':'TRANSFER_FINAL_REJECTED','Transfer '+req.params.id+' '+action.toLowerCase()+'ed by Admin',req.params.id);
        res.json({success:true,message:action==='Reassign'?'Reassignment sent to the new HoD. The applicant moves only after acceptance.':'Candidate marked Not Selected with the reason recorded.'});
    }));
    app.get('/api/coordinator/transfer-requests',requireAuth(['coordinator']),handle(async(req,res)=>res.json({requests:await list(req.user)})));
    return {
        async authorizeCandidate(req,res,next) {
            try {
                const c=await first(db,'SELECT * FROM candidates WHERE id=?',[id(req.params.id)]);
                if(!c)return res.status(404).json({error:'Candidate not found.'});
                const u=req.user;
                let allowed=u.role==='super_admin'||u.role==='admin'&&Number(u.campus_id)===Number(c.campus_id)||u.role==='hod'&&Number(u.campus_id)===Number(c.campus_id)&&Number(u.institution_id)===Number(c.institution_id)&&Number(u.department_id)===Number(c.department_id);
                if(!allowed&&['dean','coordinator'].includes(u.role)&&Number(u.campus_id)===Number(c.campus_id)) {
                    const inst=await first(db,'SELECT dean_username,coord_username FROM institutions WHERE id=?',[c.institution_id]);
                    allowed=inst&&inst[u.role==='dean'?'dean_username':'coord_username']===u.username;
                }
                if(!allowed)allowed=(await list(u)).some(tr=>tr.candidate_id===c.id);
                if(!allowed)return res.status(403).json({error:'You are not assigned to this application or its transfer.'});
                next();
            } catch(error){res.status(error.status||500).json({error:error.status?error.message:'Unable to check application access.'});}
        }
    };
};
