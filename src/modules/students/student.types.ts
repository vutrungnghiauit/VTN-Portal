export interface Student {
  id: string;
  studentCode: string;
  fullName: string;
  dateOfBirth: string;
  className: string;
  faculty: string;
  semesterName: string;
  academicStatus: string;
  email: string;
  phone: string;
  notes: string;
  createdAt: string;
  purgeAt?: string | null;
  authUserId?: string | null;
}

export type StudentInput = Omit<Student, "id" | "createdAt">;
