'use strict';
const attendanceStatus=value=>String(value??'').trim().toLowerCase();
const hasRecordedScore=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value));
function attendedInterview(candidate) {
    // Exemption is a written-test decision. Interview participation needs recorded evaluation.
    // An explicit absence takes precedence over any stale marks retained on the record.
    if(attendanceStatus(candidate.exam_attendance)==='absent')return false;
    return ['avg_interview_marks','interview_marks_1','interview_marks_2','interview_marks_3','interview_marks_4','interview_marks_5'].some(key=>hasRecordedScore(candidate[key]));
}
function summarizeMinutesAttendance(candidates) {
    return candidates.reduce((totals,candidate)=>{
        const written=attendanceStatus(candidate.exam_attendance);
        if(written==='present')totals.written_present++;
        if(written==='exempted')totals.written_exempted++;
        if(attendedInterview(candidate)) {
            totals.interview_present++;
            if(written==='exempted')totals.exempted_interview_present++;
        }
        return totals;
    },{written_present:0,written_exempted:0,interview_present:0,exempted_interview_present:0});
}
const formatMinutesScore=value=>hasRecordedScore(value)?Number(value).toFixed(1):'-';
module.exports={summarizeMinutesAttendance,attendedInterview,formatMinutesScore};
