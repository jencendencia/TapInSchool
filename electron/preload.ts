// Preload bridge: exposes the typed TapinApi on window.tapin through
// contextBridge with context isolation enabled.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  ActivityItem,
  AdviserSendResult,
  ActivationResult,
  Announcement,
  AnnouncementInput,
  Badge,
  BadgeLeaderboardRow,
  DbConfigInfo,
  DbConfigInput,
  DbConnectResult,
  EmailResult,
  EnrollmentRow,
  Excuse,
  ExcuseCategory,
  ExportResult,
  Guardian,
  GuardianInput,
  GuardianWriteResult,
  ImportResult,
  LicenseStatus,
  LogFilter,
  LoginResult,
  OverviewStats,
  ReportData,
  ReportDrilldownQuery,
  ReportDrilldownResult,
  ReportQuery,
  ScanMode,
  ScanResult,
  ScanSource,
  SchoolYear,
  Section,
  SectionInput,
  Settings,
  SmsFilter,
  SmsLog,
  SmsLogRow,
  Student,
  StudentBadgeSummary,
  StudentInput,
  SystemStatus,
  TeacherOption,
  TapinApi,
  UpdateStatus,
  User,
  UserInput,
  Visitor,
  VisitorInput,
  VisitorLogRow,
} from '../shared/types';

function on<T>(channel: string, cb: (data: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, data: T) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: TapinApi = {
  getStatus: () => ipcRenderer.invoke('tapin:getStatus') as Promise<SystemStatus>,
  getDbConfig: () => ipcRenderer.invoke('tapin:getDbConfig') as Promise<DbConfigInfo>,
  connectDb: (input: DbConfigInput) => ipcRenderer.invoke('tapin:connectDb', input) as Promise<DbConnectResult>,
  resetDbConfig: () => ipcRenderer.invoke('tapin:resetDbConfig') as Promise<DbConnectResult>,
  processScan: (payload: string, source: ScanSource) =>
    ipcRenderer.invoke('tapin:processScan', payload, source) as Promise<ScanResult>,
  getScanMode: () => ipcRenderer.invoke('tapin:getScanMode') as Promise<ScanMode>,
  setScanMode: (mode: ScanMode) => ipcRenderer.invoke('tapin:setScanMode', mode) as Promise<ScanMode>,
  getRecentActivity: (limit = 5) =>
    ipcRenderer.invoke('tapin:getRecentActivity', limit) as Promise<ActivityItem[]>,
  setKioskMode: (active: boolean) => ipcRenderer.invoke('tapin:setKioskMode', active),
  toggleFullscreen: () => ipcRenderer.invoke('tapin:toggleFullscreen'),
  windowMinimize: () => ipcRenderer.invoke('tapin:windowMinimize'),
  windowMaximizeToggle: () => ipcRenderer.invoke('tapin:windowMaximizeToggle'),
  windowClose: () => ipcRenderer.invoke('tapin:windowClose'),

  login: (username: string, password: string) =>
    ipcRenderer.invoke('tapin:login', username, password) as Promise<LoginResult>,
  logout: () => ipcRenderer.invoke('tapin:logout'),

  listUsers: () => ipcRenderer.invoke('tapin:listUsers') as Promise<User[]>,
  createUser: (input: UserInput) => ipcRenderer.invoke('tapin:createUser', input) as Promise<User>,
  updateUser: (id: number, patch: Partial<UserInput>) =>
    ipcRenderer.invoke('tapin:updateUser', id, patch) as Promise<User>,
  deleteUser: (id: number) => ipcRenderer.invoke('tapin:deleteUser', id) as Promise<void>,

  getOverview: () => ipcRenderer.invoke('tapin:getOverview') as Promise<OverviewStats>,
  listStudents: (search?: string) => ipcRenderer.invoke('tapin:listStudents', search) as Promise<Student[]>,
  createStudent: (input: StudentInput) => ipcRenderer.invoke('tapin:createStudent', input) as Promise<Student>,
  updateStudent: (id: number, input: Partial<StudentInput>) =>
    ipcRenderer.invoke('tapin:updateStudent', id, input) as Promise<Student>,
  deleteStudent: (id: number) => ipcRenderer.invoke('tapin:deleteStudent', id) as Promise<void>,
  generateQrPayload: (studentNo: string) =>
    ipcRenderer.invoke('tapin:generateQrPayload', studentNo) as Promise<string>,
  importStudentsCsv: (csv: string) => ipcRenderer.invoke('tapin:importStudentsCsv', csv) as Promise<ImportResult>,

  listGuardians: (search?: string) =>
    ipcRenderer.invoke('tapin:listGuardians', search) as Promise<Guardian[]>,
  findGuardiansByName: (name: string) =>
    ipcRenderer.invoke('tapin:findGuardiansByName', name) as Promise<Guardian[]>,
  createGuardian: (input: GuardianInput, opts?: { allowSameName?: boolean }) =>
    ipcRenderer.invoke('tapin:createGuardian', input, opts) as Promise<GuardianWriteResult>,
  updateGuardian: (id: number, patch: Partial<GuardianInput & { is_active?: boolean }>, opts?: { allowSameName?: boolean }) =>
    ipcRenderer.invoke('tapin:updateGuardian', id, patch, opts) as Promise<GuardianWriteResult>,
  deleteGuardian: (id: number) => ipcRenderer.invoke('tapin:deleteGuardian', id) as Promise<void>,

  listLogs: (filter?: LogFilter) => ipcRenderer.invoke('tapin:listLogs', filter) as Promise<{ rows: import('../shared/types').AttendanceLogRow[]; total: number }>,
  exportLogsCsv: (filter?: LogFilter) => ipcRenderer.invoke('tapin:exportLogsCsv', filter) as Promise<string>,

  listSms: (filter?: SmsFilter) => ipcRenderer.invoke('tapin:listSms', filter) as Promise<{ rows: SmsLogRow[]; total: number }>,
  retrySms: (id: number) => ipcRenderer.invoke('tapin:retrySms', id) as Promise<SmsLog>,
  retryAllFailedSms: () => ipcRenderer.invoke('tapin:retryAllFailedSms') as Promise<number>,

  getSettings: () => ipcRenderer.invoke('tapin:getSettings') as Promise<Settings>,
  updateSettings: (patch: Partial<Settings>) =>
    ipcRenderer.invoke('tapin:updateSettings', patch) as Promise<Settings>,
  verifyStaffPin: (pin: string) =>
    ipcRenderer.invoke('tapin:verifyStaffPin', pin) as Promise<boolean>,

  getJobsConfig: () => ipcRenderer.invoke('tapin:getJobsConfig') as Promise<import('../shared/types').JobsConfig>,
  setRunScheduledJobs: (active: boolean) =>
    ipcRenderer.invoke('tapin:setRunScheduledJobs', active) as Promise<import('../shared/types').JobsConfig>,

  listSections: () => ipcRenderer.invoke('tapin:listSections') as Promise<Section[]>,
  listAdvisers: () => ipcRenderer.invoke('tapin:listAdvisers') as Promise<TeacherOption[]>,
  saveSection: (input: SectionInput) => ipcRenderer.invoke('tapin:saveSection', input) as Promise<Section>,
  deleteSection: (gradeSection: string) =>
    ipcRenderer.invoke('tapin:deleteSection', gradeSection) as Promise<void>,
  assignStudentsToSection: (studentIds: number[], gradeSection: string, schoolYear: string) =>
    ipcRenderer.invoke('tapin:assignStudentsToSection', studentIds, gradeSection, schoolYear) as Promise<number>,
  setStudentEnrollment: (studentId: number, schoolYear: string, gradeSection: string) =>
    ipcRenderer.invoke('tapin:setStudentEnrollment', studentId, schoolYear, gradeSection) as Promise<void>,
  listEnrollments: (schoolYear: string) =>
    ipcRenderer.invoke('tapin:listEnrollments', schoolYear) as Promise<EnrollmentRow[]>,
  listSchoolYears: () => ipcRenderer.invoke('tapin:listSchoolYears') as Promise<SchoolYear[]>,
  saveSchoolYear: (name: string) => ipcRenderer.invoke('tapin:saveSchoolYear', name) as Promise<SchoolYear>,
setCurrentSchoolYear: (name: string) => ipcRenderer.invoke('tapin:setCurrentSchoolYear', name) as Promise<void>,
  deleteSchoolYear: (name: string) => ipcRenderer.invoke('tapin:deleteSchoolYear', name) as Promise<void>,

  getStudentBadges: (studentId: number) =>
    ipcRenderer.invoke('tapin:getStudentBadges', studentId) as Promise<StudentBadgeSummary>,
  listBadges: (schoolYear?: string, from?: string, to?: string) =>
    ipcRenderer.invoke('tapin:listBadges', schoolYear, from, to) as Promise<Badge[]>,
  badgeLeaderboard: (topN = 10, section?: string, schoolYear?: string, from?: string, to?: string) =>
    ipcRenderer.invoke('tapin:badgeLeaderboard', topN, section, schoolYear, from, to) as Promise<BadgeLeaderboardRow[]>,
  listExcuses: (studentId: number) =>
    ipcRenderer.invoke('tapin:listExcuses', studentId) as Promise<Excuse[]>,
  addExcuse: (studentId: number, excuseDate: string, category: ExcuseCategory, note?: string) =>
    ipcRenderer.invoke('tapin:addExcuse', studentId, excuseDate, category, note) as Promise<Excuse>,
  removeExcuse: (excuseId: number) => ipcRenderer.invoke('tapin:removeExcuse', excuseId) as Promise<void>,

  listAnnouncements: () => ipcRenderer.invoke('tapin:listAnnouncements') as Promise<Announcement[]>,
  createAnnouncement: (input: AnnouncementInput) =>
    ipcRenderer.invoke('tapin:createAnnouncement', input) as Promise<Announcement>,
  updateAnnouncement: (id: number, input: Partial<AnnouncementInput>) =>
    ipcRenderer.invoke('tapin:updateAnnouncement', id, input) as Promise<Announcement>,
  deleteAnnouncement: (id: number) =>
    ipcRenderer.invoke('tapin:deleteAnnouncement', id) as Promise<void>,
  listActiveAnnouncements: () =>
    ipcRenderer.invoke('tapin:listActiveAnnouncements') as Promise<Announcement[]>,

  listVisitors: (search?: string) =>
    ipcRenderer.invoke('tapin:listVisitors', search) as Promise<Visitor[]>,
  createVisitor: (input: VisitorInput) =>
    ipcRenderer.invoke('tapin:createVisitor', input) as Promise<Visitor>,
  updateVisitor: (id: number, patch: Partial<VisitorInput & { is_active?: boolean }>) =>
    ipcRenderer.invoke('tapin:updateVisitor', id, patch) as Promise<Visitor>,
  deleteVisitor: (id: number) => ipcRenderer.invoke('tapin:deleteVisitor', id) as Promise<void>,
  listVisitorLogs: (visitorId: number) =>
    ipcRenderer.invoke('tapin:listVisitorLogs', visitorId) as Promise<VisitorLogRow[]>,
  listAllVisitorLogs: (filter?: { from?: string; to?: string }) =>
    ipcRenderer.invoke('tapin:listAllVisitorLogs', filter) as Promise<VisitorLogRow[]>,

  getReport: (query: ReportQuery) => ipcRenderer.invoke('tapin:getReport', query) as Promise<ReportData>,
  getReportDrilldown: (query: ReportDrilldownQuery) =>
    ipcRenderer.invoke('tapin:getReportDrilldown', query) as Promise<ReportDrilldownResult>,
  exportReportPdf: (report: ReportData) =>
    ipcRenderer.invoke('tapin:exportReportPdf', report) as Promise<ExportResult>,
  exportReportXlsx: (report: ReportData) =>
    ipcRenderer.invoke('tapin:exportReportXlsx', report) as Promise<ExportResult>,
  sendReportEmail: (report: ReportData) =>
    ipcRenderer.invoke('tapin:sendReportEmail', report) as Promise<EmailResult>,
testEmail: (to: string, settings: Settings) =>
    ipcRenderer.invoke('tapin:testEmail', to, settings) as Promise<EmailResult>,
  sendReportToAdvisers: (from: string, to: string, schoolYear?: string) =>
    ipcRenderer.invoke('tapin:sendReportToAdvisers', from, to, schoolYear) as Promise<AdviserSendResult>,

onScanResult: (cb) => on<ScanResult>('tapin:scan-result', cb),
  onActivity: (cb) => on<ActivityItem[]>('tapin:activity', cb),
  onStatus: (cb) => on<SystemStatus>('tapin:status', cb),
  onToggleAdmin: (cb) => on<undefined>('tapin:toggle-admin', () => cb()),

  checkForUpdates: () => ipcRenderer.invoke('tapin:checkForUpdates') as Promise<{ success: boolean; message?: string }>,
  downloadUpdate: () => ipcRenderer.invoke('tapin:downloadUpdate') as Promise<{ success: boolean; message?: string }>,
  installUpdate: () => ipcRenderer.invoke('tapin:installUpdate') as Promise<{ success: boolean }>,
  getAppVersion: () => ipcRenderer.invoke('tapin:getAppVersion') as Promise<string>,
  onUpdateStatus: (cb) => on<UpdateStatus>('update-status', cb),

  checkLicense: () => ipcRenderer.invoke('tapin:checkLicense') as Promise<LicenseStatus>,
  activateLicense: (licenseKey: string) =>
    ipcRenderer.invoke('tapin:activateLicense', licenseKey) as Promise<ActivationResult>,
  getMachineId: () => ipcRenderer.invoke('tapin:getMachineId') as Promise<string>,

  // ---- Teacher Companion: Subjects, Grading, Lesson Plans -----------------
  listSubjects: (search?: string) => ipcRenderer.invoke('tapin:listSubjects', search) as any,
  getSubject: (id: number) => ipcRenderer.invoke('tapin:getSubject', id) as any,
  createSubject: (input: any) => ipcRenderer.invoke('tapin:createSubject', input) as any,
  updateSubject: (id: number, patch: any) => ipcRenderer.invoke('tapin:updateSubject', id, patch) as any,
  deleteSubject: (id: number) => ipcRenderer.invoke('tapin:deleteSubject', id) as Promise<void>,

  listTeacherSubjects: (teacherId: number, schoolYear?: string) => ipcRenderer.invoke('tapin:listTeacherSubjects', teacherId, schoolYear) as any,
  assignTeacherSubject: (teacherId: number, input: any, schoolYear?: string) => ipcRenderer.invoke('tapin:assignTeacherSubject', teacherId, input, schoolYear) as any,
  removeTeacherSubject: (id: number) => ipcRenderer.invoke('tapin:removeTeacherSubject', id) as Promise<void>,

  markSubjectAttendance: (teacherId: number, input: any, schoolYear?: string) => ipcRenderer.invoke('tapin:markSubjectAttendance', teacherId, input, schoolYear) as any,
  markBulkSubjectAttendance: (teacherId: number, subjectId: number, date: string, marks: { student_id: number; status: string; remarks?: string }[], schoolYear?: string) => ipcRenderer.invoke('tapin:markBulkSubjectAttendance', teacherId, subjectId, date, marks, schoolYear) as Promise<number>,
  getSubjectRoster: (subjectId: number, gradeSection: string, date: string, schoolYear?: string) => ipcRenderer.invoke('tapin:getSubjectRoster', subjectId, gradeSection, date, schoolYear) as any,
  getSubjectSf2: (subjectId: number, gradeSection: string, from: string, to: string, schoolYear?: string) => ipcRenderer.invoke('tapin:getSubjectSf2', subjectId, gradeSection, from, to, schoolYear) as any,
  getSubjectAttendanceSummary: (subjectId: number, gradeSection: string, from: string, to: string) => ipcRenderer.invoke('tapin:getSubjectAttendanceSummary', subjectId, gradeSection, from, to) as any,

  listGradingComponents: (subjectId: number, gradeSection: string, schoolYear: string, quarter: number) => ipcRenderer.invoke('tapin:listGradingComponents', subjectId, gradeSection, schoolYear, quarter) as any,
  createGradingComponent: (input: any) => ipcRenderer.invoke('tapin:createGradingComponent', input) as any,
  updateGradingComponent: (id: number, patch: any) => ipcRenderer.invoke('tapin:updateGradingComponent', id, patch) as any,
  deleteGradingComponent: (id: number) => ipcRenderer.invoke('tapin:deleteGradingComponent', id) as Promise<void>,
  setGradingScore: (componentId: number, studentId: number, score: number, recordedBy?: number) => ipcRenderer.invoke('tapin:setGradingScore', componentId, studentId, score, recordedBy) as any,
  setBulkGradingScores: (componentId: number, scores: { student_id: number; score: number }[], recordedBy?: number) => ipcRenderer.invoke('tapin:setBulkGradingScores', componentId, scores, recordedBy) as Promise<number>,
  getGradingSheet: (subjectId: number, gradeSection: string, schoolYear: string, quarter: number) => ipcRenderer.invoke('tapin:getGradingSheet', subjectId, gradeSection, schoolYear, quarter) as any,
  recomputeClassRecords: (subjectId: number, gradeSection: string, schoolYear: string, quarter: number, recordedBy?: number) => ipcRenderer.invoke('tapin:recomputeClassRecords', subjectId, gradeSection, schoolYear, quarter, recordedBy) as any,
  getClassRecords: (subjectId: number, gradeSection: string, schoolYear: string, quarter: number) => ipcRenderer.invoke('tapin:getClassRecords', subjectId, gradeSection, schoolYear, quarter) as any,
  getFinalGrades: (subjectId: number, gradeSection: string, schoolYear: string) => ipcRenderer.invoke('tapin:getFinalGrades', subjectId, gradeSection, schoolYear) as any,
  getTransmutationTable: () => ipcRenderer.invoke('tapin:getTransmutationTable') as any,

  listLessonPlans: (teacherId: number, filters?: any) => ipcRenderer.invoke('tapin:listLessonPlans', teacherId, filters) as any,
  getLessonPlan: (id: number) => ipcRenderer.invoke('tapin:getLessonPlan', id) as any,
  createLessonPlan: (teacherId: number, input: any) => ipcRenderer.invoke('tapin:createLessonPlan', teacherId, input) as any,
  updateLessonPlan: (id: number, patch: any) => ipcRenderer.invoke('tapin:updateLessonPlan', id, patch) as any,
  deleteLessonPlan: (id: number) => ipcRenderer.invoke('tapin:deleteLessonPlan', id) as Promise<void>,
  buildAiLessonPlanPrompt: (topic: string, gradeLevel: string, subjectName: string, objectives: string) => ipcRenderer.invoke('tapin:buildAiLessonPlanPrompt', topic, gradeLevel, subjectName, objectives) as Promise<string>,
  formatIlawAsText: (ilawData: any) => ipcRenderer.invoke('tapin:formatIlawAsText', ilawData) as Promise<string>,

  listLessonPlanTemplates: (teacherId: number, subjectId?: number) => ipcRenderer.invoke('tapin:listLessonPlanTemplates', teacherId, subjectId) as any,
  createLessonPlanTemplate: (teacherId: number, input: any) => ipcRenderer.invoke('tapin:createLessonPlanTemplate', teacherId, input) as any,
  useLessonPlanTemplate: (templateId: number) => ipcRenderer.invoke('tapin:useLessonPlanTemplate', templateId) as Promise<void>,
  deleteLessonPlanTemplate: (id: number) => ipcRenderer.invoke('tapin:deleteLessonPlanTemplate', id) as Promise<void>,
};

contextBridge.exposeInMainWorld('tapin', api);
