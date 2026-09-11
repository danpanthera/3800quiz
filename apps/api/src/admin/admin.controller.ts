import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AttemptViolationType, UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminService } from './admin.service';
import { ImportBankQuestionsDto } from './dto/import-bank-questions.dto';

const TRAINING_ROLES = [UserRole.ADMIN, UserRole.TRAINER] as const;

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  // ── Subjects ──────────────────────────────────────────────────────────
  @Get('subjects')
  @Roles(...TRAINING_ROLES)
  getSubjects() {
    return this.adminService.getSubjects();
  }

  @Post('subjects')
  @Roles(...TRAINING_ROLES)
  createSubject(@Body() body: { name: string; description?: string }) {
    return this.adminService.createSubject(body);
  }

  @Put('subjects/:id')
  @Roles(...TRAINING_ROLES)
  updateSubject(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string },
  ) {
    return this.adminService.updateSubject(id, body);
  }

  @Delete('subjects/:id')
  @Roles(...TRAINING_ROLES)
  deleteSubject(@Param('id') id: string) {
    return this.adminService.deleteSubject(id);
  }

  // ── Bank Questions ────────────────────────────────────────────────────
  @Get('bank-questions')
  @Roles(...TRAINING_ROLES)
  getBankQuestions(@Query('subjectId') subjectId?: string) {
    return this.adminService.getBankQuestions(subjectId);
  }

  @Post('bank-questions')
  @Roles(...TRAINING_ROLES)
  createBankQuestion(@Request() req: any, @Body() body: any) {
    return this.adminService.createBankQuestion(body, req.user);
  }

  @Put('bank-questions/:id')
  @Roles(...TRAINING_ROLES)
  updateBankQuestion(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateBankQuestion(id, body);
  }

  @Delete('bank-questions/:id')
  @Roles(...TRAINING_ROLES)
  deleteBankQuestion(@Param('id') id: string) {
    return this.adminService.deleteBankQuestion(id);
  }

  @Delete('bank-questions')
  @Roles(...TRAINING_ROLES)
  deleteAllBankQuestions(@Query('subjectId') subjectId?: string) {
    return this.adminService.deleteAllBankQuestions(subjectId);
  }

  // ── Import Excel ─────────────────────────────────────────────────────
  @Post('bank-questions/import/sheets')
  @Roles(...TRAINING_ROLES)
  @UseInterceptors(FileInterceptor('file'))
  getImportSheetNames(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Chưa chọn file');
    return { sheetNames: this.adminService.getExcelSheetNames(file.buffer) };
  }

  @Post('bank-questions/import')
  @Roles(...TRAINING_ROLES)
  @UseInterceptors(FileInterceptor('file'))
  importQuestions(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body('subjectId') subjectId: string,
    @Body('dryRun') dryRun?: string,
    @Body('sheetName') sheetName?: string,
  ) {
    return this.adminService.importQuestionsFromExcel(
      file.buffer,
      subjectId,
      dryRun === 'true',
      sheetName,
      req.user,
    );
  }

  // Xác nhận import từ các dòng admin đã xem/sửa trên modal xem trước — thay vì
  // upload lại file Excel gốc (không còn khớp nếu admin đã chỉnh nội dung).
  @Post('bank-questions/import/confirm')
  @Roles(...TRAINING_ROLES)
  confirmImportBankQuestions(
    @Request() req: any,
    @Body() body: ImportBankQuestionsDto,
  ) {
    return this.adminService.importBankQuestionRows(
      body.subjectId,
      body.rows,
      req.user,
    );
  }

  // ── Duplicate check ───────────────────────────────────────────────────
  @Post('bank-questions/check-duplicates')
  @Roles(...TRAINING_ROLES)
  checkDuplicates(@Body() body: { texts: string[] }) {
    return this.adminService.checkDuplicates(body.texts);
  }

  // ── Spell check ───────────────────────────────────────────────────────
  @Post('bank-questions/check-spelling')
  @Roles(...TRAINING_ROLES)
  checkSpelling(@Body() body: { texts: string[] }) {
    return this.adminService.checkSpelling(body.texts);
  }

  // ── Questions ─────────────────────────────────────────────────────────
  @Get('questions')
  @Roles(...TRAINING_ROLES)
  getQuestions() {
    return this.adminService.getQuestions();
  }

  @Delete('questions/:id')
  @Roles(...TRAINING_ROLES)
  deleteQuestion(@Param('id') id: string) {
    return this.adminService.deleteQuestion(id);
  }

  // ── Quizzes ───────────────────────────────────────────────────────────
  @Get('quizzes')
  @Roles(...TRAINING_ROLES)
  getQuizzes() {
    return this.adminService.getQuizzes();
  }

  @Get('quizzes/:id')
  @Roles(...TRAINING_ROLES)
  getQuiz(@Param('id') id: string) {
    return this.adminService.getQuiz(id);
  }

  @Post('quizzes')
  @Roles(...TRAINING_ROLES)
  createQuiz(
    @Body()
    body: {
      title: string;
      description?: string;
      topic?: string;
      durationMin: number;
      passScore?: number;
      instantFeedback?: boolean;
      maxAttempts?: number;
    },
  ) {
    return this.adminService.createQuiz(body);
  }

  @Put('quizzes/:id')
  @Roles(...TRAINING_ROLES)
  updateQuiz(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateQuiz(id, body);
  }

  @Delete('quizzes/:id')
  @Roles(...TRAINING_ROLES)
  deleteQuiz(@Param('id') id: string) {
    return this.adminService.deleteQuiz(id);
  }

  @Post('quizzes/:id/duplicate')
  @Roles(...TRAINING_ROLES)
  duplicateQuiz(@Param('id') id: string) {
    return this.adminService.duplicateQuiz(id);
  }

  @Post('quizzes/:id/pick-random')
  @Roles(...TRAINING_ROLES)
  pickRandom(
    @Param('id') id: string,
    @Body()
    body: {
      subjectId?: string;
      count?: number;
      subjectSlots?: { subjectId?: string; count: number }[];
      replaceAll?: boolean;
    },
  ) {
    return this.adminService.pickRandomToQuiz(id, body);
  }

  // ── Assignments ───────────────────────────────────────────────────────
  @Get('assignments')
  @Roles(...TRAINING_ROLES)
  getAssignments() {
    return this.adminService.getAssignments();
  }

  @Post('assignments')
  @Roles(...TRAINING_ROLES)
  createAssignment(@Body() body: any) {
    return this.adminService.createAssignment(body);
  }
  @Post('assignments/bulk')
  @Roles(...TRAINING_ROLES)
  createAssignmentsBulk(@Body() body: any) {
    return this.adminService.createAssignmentsBulk(body);
  }

  // Các route "assignments/<tên cố định>" PHẢI khai báo TRƯỚC "assignments/:id" —
  // Nest/Express khớp route theo thứ tự khai báo, ":id" là wildcard sẽ nuốt luôn
  // "extend"/"import" nếu đứng sau (đã từng dính lỗi 500 vì thứ tự sai).
  @Put('assignments/extend')
  @Roles(...TRAINING_ROLES)
  extendAssignmentsByFilter(
    @Body() body: { newEndAt: string; quizId?: string; departmentId?: string },
  ) {
    return this.adminService.extendAssignmentsByFilter(
      body.newEndAt,
      body.quizId,
      body.departmentId,
    );
  }

  // Import danh sách phân công qua Excel — file 1 cột mã cán bộ/User AD/username
  @Post('assignments/import')
  @Roles(...TRAINING_ROLES)
  @UseInterceptors(FileInterceptor('file'))
  importAssignments(
    @UploadedFile() file: Express.Multer.File,
    @Body('quizId') quizId: string,
    @Body('startAt') startAt?: string,
    @Body('endAt') endAt?: string,
  ) {
    if (!file) throw new BadRequestException('Chưa chọn file');
    return this.adminService.importAssignmentsFromExcel(
      file.buffer,
      quizId,
      startAt,
      endAt,
    );
  }

  @Put('assignments/:id')
  @Roles(...TRAINING_ROLES)
  updateAssignment(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateAssignment(id, body);
  }

  @Delete('assignments/:id')
  @Roles(...TRAINING_ROLES)
  deleteAssignment(@Param('id') id: string) {
    return this.adminService.deleteAssignment(id);
  }

  // Xóa hàng loạt theo bộ đề và/hoặc chi nhánh/phòng ban (dùng cho nút "Xóa theo bộ lọc")
  @Delete('assignments')
  @Roles(...TRAINING_ROLES)
  deleteAssignmentsByFilter(
    @Query('quizId') quizId?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    return this.adminService.deleteAssignmentsByFilter(quizId, departmentId);
  }

  // ── Reports ───────────────────────────────────────────────────────────
  @Get('reports')
  @Roles(...TRAINING_ROLES)
  getReports() {
    return this.adminService.getReports();
  }

  @Get('reports/trends')
  @Roles(...TRAINING_ROLES)
  getReportTrends(@Query('groupBy') groupBy?: 'week' | 'month') {
    return this.adminService.getReportTrends(groupBy ?? 'week');
  }

  @Delete('reports/bulk')
  @Roles(...TRAINING_ROLES)
  deleteReportsBulk(
    @Body() body: { ids: string[] },
    @Request() req: { user: { id: string } },
  ) {
    return this.adminService.deleteReportsBulk(body.ids, req.user.id);
  }

  @Delete('reports/:id')
  @Roles(...TRAINING_ROLES)
  deleteReport(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.adminService.deleteReport(id, req.user.id);
  }

  @Get('audit-logs')
  getAuditLogs(
    @Query()
    query: {
      action?: string;
      userId?: string;
      from?: string;
      to?: string;
      limit?: string;
    },
  ) {
    return this.adminService.getAuditLogs({
      ...query,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  @Get('attempt-violations')
  @Roles(...TRAINING_ROLES)
  getAttemptViolations(
    @Query()
    query: {
      type?: AttemptViolationType;
      userId?: string;
      quizId?: string;
      limit?: string;
    },
  ) {
    return this.adminService.getAttemptViolations({
      ...query,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  @Get('question-analytics')
  @Roles(...TRAINING_ROLES)
  getQuestionAnalytics(
    @Query() query: { quizId?: string; subjectId?: string },
  ) {
    return this.adminService.getQuestionAnalytics(query);
  }

  @Get('department-performance')
  @Roles(...TRAINING_ROLES)
  getDepartmentPerformance() {
    return this.adminService.getDepartmentPerformance();
  }

  @Get('at-risk-staff')
  @Roles(...TRAINING_ROLES)
  getAtRiskStaff() {
    return this.adminService.getAtRiskStaff();
  }

  // ── Users ─────────────────────────────────────────────────────────────
  @Get('users')
  @Roles(...TRAINING_ROLES)
  getUsers() {
    return this.adminService.getUsers();
  }

  // ── Academic Years ────────────────────────────────────────────────────
  @Get('academic-years')
  @Roles(...TRAINING_ROLES)
  getAcademicYears() {
    return this.adminService.getAcademicYears();
  }

  @Post('academic-years')
  createAcademicYear(
    @Body()
    body: {
      name: string;
      startYear: number;
      endYear: number;
      isActive?: boolean;
    },
  ) {
    return this.adminService.createAcademicYear(body);
  }

  @Put('academic-years/:id')
  updateAcademicYear(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateAcademicYear(id, body);
  }

  @Delete('academic-years/:id')
  deleteAcademicYear(@Param('id') id: string) {
    return this.adminService.deleteAcademicYear(id);
  }

  // ── Classes ───────────────────────────────────────────────────────────
  @Get('classes')
  @Roles(...TRAINING_ROLES)
  getClasses(@Query('academicYearId') academicYearId?: string) {
    return this.adminService.getClasses(academicYearId);
  }

  @Get('classes/:id')
  @Roles(...TRAINING_ROLES)
  getClass(@Param('id') id: string) {
    return this.adminService.getClass(id);
  }

  @Post('classes')
  createClass(@Body() body: any) {
    return this.adminService.createClass(body);
  }

  @Put('classes/:id')
  updateClass(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateClass(id, body);
  }

  @Delete('classes/:id')
  deleteClass(@Param('id') id: string) {
    return this.adminService.deleteClass(id);
  }

  @Post('classes/:id/members')
  addClassMember(
    @Param('id') classId: string,
    @Body() body: { userId: string },
  ) {
    return this.adminService.addClassMember(classId, body.userId);
  }

  @Post('classes/:id/members/bulk')
  addClassMembersBulk(
    @Param('id') classId: string,
    @Body() body: { userIds: string[] },
  ) {
    return this.adminService.addClassMembersbulk(classId, body.userIds);
  }

  @Delete('classes/:id/members/:userId')
  removeClassMember(
    @Param('id') classId: string,
    @Param('userId') userId: string,
  ) {
    return this.adminService.removeClassMember(classId, userId);
  }

  // ── Exam Sessions ─────────────────────────────────────────────────────
  @Get('exam-sessions')
  @Roles(...TRAINING_ROLES)
  getExamSessions(@Query('classId') classId?: string) {
    return this.adminService.getExamSessions(classId);
  }

  @Get('exam-sessions/:id')
  @Roles(...TRAINING_ROLES)
  getExamSession(@Param('id') id: string) {
    return this.adminService.getExamSession(id);
  }

  @Post('exam-sessions')
  @Roles(...TRAINING_ROLES)
  createExamSession(@Body() body: any) {
    return this.adminService.createExamSession(body);
  }

  @Put('exam-sessions/:id')
  @Roles(...TRAINING_ROLES)
  updateExamSession(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateExamSession(id, body);
  }

  @Delete('exam-sessions/:id')
  @Roles(...TRAINING_ROLES)
  deleteExamSession(@Param('id') id: string) {
    return this.adminService.deleteExamSession(id);
  }

  @Get('exam-sessions/:id/gradebook')
  @Roles(...TRAINING_ROLES)
  getGradebook(@Param('id') id: string) {
    return this.adminService.getExamSessionGradebook(id);
  }

  @Get('exam-sessions/:id/leaderboard')
  @Roles(...TRAINING_ROLES)
  getLeaderboard(@Param('id') id: string) {
    return this.adminService.getExamSessionLeaderboard(id);
  }

  @Get('exam-sessions/:id/attempts/:userId')
  @Roles(...TRAINING_ROLES)
  getAttemptHistory(
    @Param('id') sessionId: string,
    @Param('userId') userId: string,
  ) {
    return this.adminService.getAttemptHistory(sessionId, userId);
  }

  @Get('exam-sessions/:id/export')
  @Roles(...TRAINING_ROLES)
  async exportGradebook(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.adminService.exportGradebook(id);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
    return new StreamableFile(buffer);
  }

  @Get('exam-sessions/:id/question-stats')
  @Roles(...TRAINING_ROLES)
  getQuestionStats(@Param('id') id: string) {
    return this.adminService.getQuestionStats(id);
  }

  @Get('exam-sessions/:id/not-attempted')
  @Roles(...TRAINING_ROLES)
  getNotAttempted(@Param('id') id: string) {
    return this.adminService.getNotAttempted(id);
  }

  @Get('exam-sessions/:id/certificate/:userId')
  @Roles(...TRAINING_ROLES)
  getCertificateData(@Param('id') id: string, @Param('userId') userId: string) {
    return this.adminService.getCertificateData(id, userId);
  }

  // ── Departments ───────────────────────────────────────────────────────
  @Get('departments')
  @Roles(...TRAINING_ROLES)
  getDepartments() {
    return this.adminService.getDepartments();
  }

  @Post('departments')
  createDepartment(
    @Body() body: { name: string; code: string; parentId?: string | null },
  ) {
    return this.adminService.createDepartment(body);
  }

  @Put('departments/:id')
  updateDepartment(
    @Param('id') id: string,
    @Body() body: { name?: string; code?: string; parentId?: string | null },
  ) {
    return this.adminService.updateDepartment(id, body);
  }

  @Delete('departments/:id')
  deleteDepartment(@Param('id') id: string) {
    return this.adminService.deleteDepartment(id);
  }

  // ── Cán bộ ────────────────────────────────────────────────────────────
  @Get('can-bo')
  @Roles(...TRAINING_ROLES)
  getCanBo(
    @Query('search') search?: string,
    @Query('departmentId') departmentId?: string,
    @Query('unitId') unitId?: string,
  ) {
    return this.adminService.getCanBo(search, departmentId, unitId);
  }

  @Post('can-bo/reset-passwords')
  resetCanBoPasswords(
    @Body() body: { ids: string[] },
    @Request() req: { user: { id: string } },
  ) {
    return this.adminService.resetCanBoPasswords(body.ids, req.user.id);
  }

  @Delete('can-bo/bulk')
  bulkDeleteCanBo(
    @Body() body: { ids: string[] },
    @Request() req: { user: { id: string } },
  ) {
    return this.adminService.bulkDeleteCanBo(body.ids, req.user.id);
  }

  @Post('can-bo/import')
  @UseInterceptors(FileInterceptor('file'))
  importCanBo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Chưa chọn file');
    return this.adminService.importCanBoFromGahr26(file.buffer);
  }

  @Post('can-bo')
  createCanBo(@Body() body: any) {
    return this.adminService.createCanBo(body);
  }

  @Put('can-bo/:id')
  updateCanBo(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateCanBo(id, body);
  }

  @Delete('can-bo/:id')
  deleteCanBo(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.adminService.deleteCanBo(id, req.user.id);
  }
}
