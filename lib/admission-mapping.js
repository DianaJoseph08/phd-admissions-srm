'use strict';
function normalize(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}
// Explicit Meritto aliases. Do not search another campus or faculty for a department.
const trichyInstitutes = [
    ['Faculty of Engineering and Technology', 'College of Engineering', 'College of Engineering and Technology'],
    ['Faculty of Science and Humanities', 'College of Science and Humanities'],
    ['College of Allied Health Sciences', 'Faculty of Medical and Allied Health Sciences'],
    ['College of Management Studies', 'College of Management', 'Collge of Management']
];
function institutionKey(name, campusId) {
    const key = normalize(name);
    if (Number(campusId) === 2) {
        const group = trichyInstitutes.find(names => names.some(n => normalize(n) === key));
        if (group) return normalize(group[0]);
    }
    return key;
}
function departmentKey(name) {
    const key = normalize(name);
    return key === 'anesthesiatechnology' ? 'anaesthesiatechnology' : key;
}
function readImportField(row, preferredHeaders) {
    for (const header of preferredHeaders) {
        const key = Object.keys(row).find(k => normalize(k) === normalize(header));
        if (key !== undefined) return String(row[key] ?? '').trim();
    }
    return '';
}
function resolveAdmissionMapping(institute, department, campusId, metadata) {
    if (!normalize(institute)) return {match: null, reason: 'Institute is blank'};
    if (!normalize(department)) return {match: null, reason: 'Department is blank'};
    const institutions = metadata.filter(m => Number(m.campus_id) === Number(campusId) && (Number(campusId) !== 2 || [5, 6, 7, 9].includes(Number(m.inst_id))) && institutionKey(m.inst_name, campusId) === institutionKey(institute, campusId));
    if (!institutions.length) return {match: null, reason: 'Institute is not configured in this campus'};
    const approvedEngineering = new Set(require('./trichy-admission-catalog.json').institutions.find(i => Number(i.id) === 5).departments.map(departmentKey));
    const matches = institutions.filter(m => !(Number(campusId) === 2 && Number(m.inst_id) === 6 && departmentKey(m.dept_name) === 'english') && (Number(campusId) !== 2 || Number(m.inst_id) !== 5 || approvedEngineering.has(departmentKey(m.dept_name))) && departmentKey(m.dept_name) === departmentKey(department));
    if (matches.length !== 1) return {match: null, reason: matches.length ? 'Department mapping is ambiguous' : 'Department is not configured under this institute'};
    return {match: matches[0], reason: null};
}
function normalizeFormStatus(value) {
    const status = String(value ?? '').trim();
    if (['complete', 'completed'].includes(status.toLowerCase())) return 'Complete';
    if (status.toLowerCase() === 'incomplete') return 'Incomplete';
    return status || 'Complete';
}
module.exports = {normalizeFormStatus, normalize, institutionKey, departmentKey, readImportField, resolveAdmissionMapping};

// Column CO is the sole source of the admissions study mode for both campuses.
function readAdmissionRows(sheet, xlsx, campusId) {
    const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
    const headerRow = range.s.r + 1;
    if (normalize(sheet['CO' + headerRow]?.v) !== 'modeofstudy') {
        const error = new Error('Column CO must be headed "Mode Of Study". Upload the full Meritto Excel export with its original column positions.');
        error.status = 400;
        throw error;
    }
    const rows = xlsx.utils.sheet_to_json(sheet, {defval: '', blankrows: false});
    // Meritto repeats Program: preserve the Trichy admissions block beside Institute.
    if (Number(campusId) === 2) {
        const headers = xlsx.utils.sheet_to_json(sheet, {header: 1, defval: '', blankrows: false})[0] || [];
        const institute = headers.findIndex(h => normalize(h) === 'institute');
        const block = ['Institute', 'Department', 'Mode Of Study', 'Program'];
        if (institute >= 0 && block.every((h,i)=>normalize(headers[institute+i])===normalize(h))) {
            rows.forEach(row=>block.forEach((h,j)=>row[h]=String(sheet[xlsx.utils.encode_cell({r:row.__rowNum__,c:range.s.c+institute+j})]?.v ?? '').trim()));
        }
    }
    rows.forEach(row => {
        const mode = String(sheet['CO' + (row.__rowNum__ + 1)]?.v ?? '').trim();
        // Remove aliases so a blank CO cannot fall through to another study-mode field.
        Object.keys(row).filter(key => normalize(key) === 'modeofstudy').forEach(key => delete row[key]);
        row['Mode Of Study'] = mode;
    });
    return rows;
}
module.exports.readAdmissionRows = readAdmissionRows;
