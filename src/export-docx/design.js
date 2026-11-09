// Shared, deterministic report presentation tokens. No schema fields or I/O.
import { cvssBand } from '../scoring/index.js';
const LEVELS = Object.freeze({Critical:'7B1FA2',High:'C62828',Medium:'B54708',Low:'2E7D32',Informational:'1565C0'});
export function reportDesign(accent) {
  const rgb=accent.match(/../g).map(h=>parseInt(h,16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  const luminance=0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
  return {accent,onAccent:1.05/(luminance+0.05)>=4.5?'FFFFFF':(luminance+0.05)/0.073>=4.5?'172B45':'000000',ink:'172B45',muted:'52647A',line:'D5DFE9',soft:'F4F7FA',labelFill:'EDF2F7',
    codeFill:'F2F5F8',codeBorder:'D8E1EA',white:'FFFFFF',levels:{...LEVELS},
    bodyFont:'Calibri',codeFont:'Consolas',bodyPt:11,titlePt:32,compactTitlePt:24,subtitlePt:14,heading1Pt:17,
    heading2Pt:12,captionPt:9.5,tablePt:10,countTablePt:9,codePt:9,smallPt:8,
    bodyAfterPt:4,bodyLinePt:13,codeLinePt:11,heading2BeforePt:6,heading2AfterPt:3,
    captionAfterPt:5,imageBeforePt:4.5,imageAfterPt:1.5,shortSectionMaxLines:6,
    cellPadding:{top:80,bottom:80,left:140,right:140},countCellPadding:{top:55,bottom:55,left:70,right:70}};
}
export function ratingBadge(level) {
  return Object.hasOwn(LEVELS,level) ? {level,fill:LEVELS[level],textColor:'FFFFFF'} : null;
}
export function cvssBadge(score) {
  const level = cvssBand(score);
  if (level === null) return null;
  if (level === 'None') return {level,fill:'E7EDF3',textColor:'40546D'};
  return ratingBadge(level);
}
