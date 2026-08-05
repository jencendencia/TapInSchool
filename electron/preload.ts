// Preload bridge: exposes the typed TapinApi on window.tapin through
// contextBridge with context isolation enabled.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  ActivityItem,
  AdviserSendResult,
  ActivationResult,
  EmailResult,
  EnrollmentRow,
  ExportResult,
  ImportResult,
  LicenseStatus,
  LogFilter,
  LoginResult,
  OverviewStats,
  ReportData,
  ReportQuery,
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
  StudentInput,
  SystemStatus,
  TapinApi,
  UpdateStatus,
} from '../shared/types';

function on<T>(channel: string, cb: (data: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, data: T) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: TapinApi = {
  getStatus: () => ipcRenderer.invoke('tapin:getStatus') as Promise<SystemStatus>,
  processScan: (payload: string, source: ScanSource) =>
    ipcRenderer.invoke('tapin:processScan', payload, source) as Promise<ScanResult>,
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

  getOverview: () => ipcRenderer.invoke('tapin:getOverview') as Promise<OverviewStats>,
  listStudents: (search?: string) => ipcRenderer.invoke('tapin:listStudents', search) as Promise<Student[]>,
  createStudent: (input: StudentInput) => ipcRenderer.invoke('tapin:createStudent', input) as Promise<Student>,
  updateStudent: (id: number, input: Partial<StudentInput>) =>
    ipcRenderer.invoke('tapin:updateStudent', id, input) as Promise<Student>,
  deleteStudent: (id: number) => ipcRenderer.invoke('tapin:deleteStudent', id) as Promise<void>,
  generateQrPayload: (studentNo: string) =>
    ipcRenderer.invoke('tapin:generateQrPayload', studentNo) as Promise<string>,
  importStudentsCsv: (csv: string) => ipcRenderer.invoke('tapin:importStudentsCsv', csv) as Promise<ImportResult>,
  seedDemoData: () => ipcRenderer.invoke('tapin:seedDemoData') as Promise<ImportResult>,

  listLogs: (filter?: LogFilter) => ipcRenderer.invoke('tapin:listLogs', filter) as Promise<{ rows: import('../shared/types').AttendanceLogRow[]; total: number }>,
  exportLogsCsv: (filter?: LogFilter) => ipcRenderer.invoke('tapin:exportLogsCsv', filter) as Promise<string>,

  listSms: (filter?: SmsFilter) => ipcRenderer.invoke('tapin:listSms', filter) as Promise<{ rows: SmsLogRow[]; total: number }>,
  retrySms: (id: number) => ipcRenderer.invoke('tapin:retrySms', id) as Promise<SmsLog>,
  testSms: (phone: string) => ipcRenderer.invoke('tapin:testSms', phone) as Promise<{ ok: boolean; message: string }>,

  getSettings: () => ipcRenderer.invoke('tapin:getSettings') as Promise<Settings>,
  updateSettings: (patch: Partial<Settings>) =>
    ipcRenderer.invoke('tapin:updateSettings', patch) as Promise<Settings>,

  listSections: () => ipcRenderer.invoke('tapin:listSections') as Promise<Section[]>,
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

  getReport: (query: ReportQuery) => ipcRenderer.invoke('tapin:getReport', query) as Promise<ReportData>,
  exportReportPdf: (report: ReportData) =>
    ipcRenderer.invoke('tapin:exportReportPdf', report) as Promise<ExportResult>,
  exportReportXlsx: (report: ReportData) =>
    ipcRenderer.invoke('tapin:exportReportXlsx', report) as Promise<ExportResult>,
  sendReportEmail: (report: ReportData) =>
    ipcRenderer.invoke('tapin:sendReportEmail', report) as Promise<EmailResult>,
  testEmail: (to: string) => ipcRenderer.invoke('tapin:testEmail', to) as Promise<EmailResult>,
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
};

contextBridge.exposeInMainWorld('tapin', api);
