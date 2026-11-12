// Workflow annotations, not severity or automated verification. Model owns enums.
import { FINDING_STATUSES, ENGAGEMENT_STATUSES } from '../app/project.js';

const findingLabels=Object.freeze({open:'Open',fixed:'Fixed',partly_fixed:'Partly fixed',risk_accepted:'Risk accepted',false_positive:'False positive'});
const engagementLabels=Object.freeze({draft:'Draft',in_review:'In review',delivered:'Delivered',retest_due:'Retest due'});
function format(status,allowed,labels,notSet) {
  if (typeof notSet!=='string'||!/\S/.test(notSet)) throw new Error('A nonempty unset-status label is required.');
  if (status===null) return notSet;
  if (!allowed.includes(status)||!Object.hasOwn(labels,status)) throw new Error('Invalid workflow status.');
  return labels[status];
}
export function formatFindingStatus(status,{notSet='Not set'}={}) {
  return format(status,FINDING_STATUSES,findingLabels,notSet);
}
export function formatEngagementStatus(status,{notSet='Not set'}={}) {
  return format(status,ENGAGEMENT_STATUSES,engagementLabels,notSet);
}
/** Every finding once, including unset. Display flags do not change these data. */
export function findingStatusCounts(doc) {
  if (![4,5,6,7].includes(doc?.schemaVersion)||!Array.isArray(doc.findings)) throw new Error('A validated schema v4 to v7 project is required.');
  const labels=doc.project.labels;
  const rows=[...FINDING_STATUSES,null].map(key=>({key,label:formatFindingStatus(key,{notSet:labels.statusNotSet}),count:0}));
  for (const finding of doc.findings) {
    const row=rows.find(r=>r.key===finding.status);
    if (!row) throw new Error('Invalid finding workflow status.');
    row.count++;
  }
  return {label:labels.status,rows,total:doc.findings.length};
}
