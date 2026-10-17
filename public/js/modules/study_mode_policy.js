'use strict';
(function(root,factory){const policy=factory();if(typeof module==='object'&&module.exports)module.exports=policy;else root.AdmissionStudyPolicy=policy;})(typeof globalThis!=='undefined'?globalThis:this,function(){
    const compact=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^a-z]/g,'');
    const words=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^a-z]+/g,' ').trim();
    const full=value=>compact(value).includes('fulltime')||/^ft(?:\s|$)/.test(words(value));
    const part=value=>compact(value).includes('parttime')||/^pt(?:\s|$)/.test(words(value));
    function funding(value){
        const text=compact(value),tokens=words(value);
        if(text.includes('withoutfellowship')||text.includes('nofellowship')||text.includes('nonfellowship')||text.includes('selfsupport')||text.includes('selffinanc')||/\b(?:ss|wof|nf)\b/.test(tokens))return 'without';
        if(text.includes('fellowship')||/\bwf\b/.test(tokens))return 'with';
        return null;
    }
    function classifyStudyMode(candidate){
        const mode=String(candidate.mode_of_study||'').trim();
        if(part(mode))return 'part_time';
        if(!full(mode))return 'other';
        const category=funding(mode);
        if(category==='without')return 'full_time_without_fellowship';
        if(category==='with')return 'full_time_with_fellowship';
        return 'full_time_unspecified';
    }
    // An unspecified funding mode does not establish fellowship eligibility.
    const genericFullTimeUsesFellowshipAllotment=false;
    const isFullTimeApplicant=c=>classifyStudyMode(c).startsWith('full_time_');
    const isFullTimeWithFellowship=c=>{const mode=classifyStudyMode(c);return mode==='full_time_with_fellowship'||genericFullTimeUsesFellowshipAllotment&&mode==='full_time_unspecified';};
    const isFullTimeWithoutFellowship=c=>classifyStudyMode(c)==='full_time_without_fellowship';
    return {classifyStudyMode,isFullTimeApplicant,isFullTimeWithFellowship,isFullTimeWithoutFellowship,genericFullTimeUsesFellowshipAllotment};
});
