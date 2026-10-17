function studyModeText(value) {
    return String(value || '').toLowerCase().replace(/[-_]/g,' ').replace(/\s+/g,' ').trim();
}
function candidateMatchesStudyMode(c) {
    const key = state.candidateStudyMode || 'all';
    const value = studyModeText(c.mode_of_study);
    if (key === 'all') return true;
    if (key === 'fulltime_all') return AdmissionStudyPolicy.isFullTimeApplicant(c);
    const mode = STUDY_MODES.find(m => m.key === key);
    return mode ? mode.match(value,c) : true;
}
function studyModeFilterLabel() {
    const key = state.candidateStudyMode || 'all';
    return key === 'all' ? 'All Study Modes' : key === 'fulltime_all' ? 'Full Time — All (With and Without Fellowship)' : (STUDY_MODES.find(m => m.key === key)?.label || 'All Study Modes');
}
function setCandidateStudyMode(value) {
    state.candidateStudyMode = value;
    renderCandidatesTable();
}
function isExternalEmploymentView() { return ['pte_ind','pte_acad'].includes(state.candidateStudyMode); }
function renderStudyModeFilter() {
    const options = [{key:'all',label:'All Study Modes'},{key:'fulltime_all',label:'Full Time — All (With and Without Fellowship)'},...STUDY_MODES];
    return '<div class="candidate-study-controls"><label for="candidate-study-mode">Mode of Study</label><select id="candidate-study-mode" class="form-select" style="width:auto;min-width:240px" onchange="setCandidateStudyMode(this.value)">'+options.map(m => '<option value="'+m.key+'" '+((state.candidateStudyMode || 'all') === m.key ? 'selected' : '')+'>'+m.label+'</option>').join('')+'</select><button class="btn btn-secondary" onclick="downloadFilteredNameList()"><i class="fa-solid fa-file-excel"></i> Name List</button>'+(state.user.role !== 'hod' ? '<button class="btn btn-secondary" onclick="downloadFilteredNameList(true)">Name List — All My Institutes</button>' : '')+(isExternalEmploymentView() ? '<span style="color:var(--text-secondary)">Employment: position and company / institution. Missing details show Not provided.</span>' : '')+'</div>';
}
function buildFilteredNameRows(list) {
    return list.map((c,i)=>({'S.No':i+1,'Application No':c.application_no || '',Name:c.registered_name || '',Campus:c.campus_name || '',Institute:c.institution_name || '',Department:c.department_name || '', 'Mode of Study':c.mode_of_study || '', ...(isExternalEmploymentView() ? {'Position / Designation':c.employment_position || 'Not provided','Company / Institution':c.employment_organization || 'Not provided'} : {})}));
}
function downloadFilteredNameList(allInstitutes = false) {
    const list = getFilteredCandidateList(allInstitutes, allInstitutes);
    if (!list.length) return showToast('No applicants match the current filters.','error');
    const wb=XLSX.utils.book_new(), ws=XLSX.utils.json_to_sheet(buildFilteredNameRows(list));
    ws['!cols']=Object.keys(buildFilteredNameRows(list)[0]).map(()=>({wch:28}));
    XLSX.utils.book_append_sheet(wb,ws,'Applicant Name List');
    XLSX.writeFile(wb,'PhD_Name_List_'+(state.activeCandidateFilter || 'All').replace(/\W+/g,'_')+'_'+studyModeFilterLabel().replace(/\W+/g,'_')+'.xlsx');
}
