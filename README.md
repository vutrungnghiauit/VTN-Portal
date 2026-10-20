# VTN Portal — Quản lý giảng dạy

## Cài đặt

1. Tạo `.env.local` từ `.env.example` và điền Supabase Project URL cùng publishable key. Không đưa secret key vào mã chạy trên trình duyệt.
2. Trong Supabase SQL Editor, chạy lần lượt `supabase/students.sql`, `supabase/workspace.sql`, `supabase/security.sql`, `supabase/system-settings.sql`, `supabase/notifications.sql`, `supabase/audit.sql`, `supabase/trash-retention.sql`, `supabase/student-analytics.sql`, `supabase/support-tickets.sql`, `supabase/semester-sync.sql`, rồi `supabase/super-admin-delete.sql`, rồi `supabase/rbac-actions.sql`.
3. Mời hoặc tạo người dùng tại **Authentication → Users**, rồi đăng nhập tại ứng dụng.
4. Chạy `npm run dev`.

## Phạm vi hiện có

- Module Sinh viên dùng bảng riêng, tìm kiếm, hồ sơ, xóa mềm và khôi phục.
- Các module nghiệp vụ còn lại dùng bảng `workspace_records` để tạo, tìm, sửa và chuyển bản ghi vào thùng rác theo module.
- Tổng quan, hồ sơ tài khoản, hướng dẫn mời tài khoản, trạng thái RLS, xuất/nhập JSON, chọn ngẫu nhiên và nhật ký thao tác có trang riêng.
- Quyền truy cập được kiểm tra ở giao diện và trong Postgres RLS/RPC. Tài khoản mới mặc định là sinh viên; gán vai trò đáng tin cậy qua trang quản trị hoặc thao tác SQL của project owner. Super Admin không thể được cấp từ giao diện và không thể sửa quyền qua ma trận.
- Nhật ký ghi thao tác trên hồ sơ sinh viên và bản ghi module, có chi tiết trước/sau và IP nếu Supabase cung cấp header IP. RLS giới hạn log theo vai trò và sinh viên do giảng viên sở hữu.
- Dữ liệu xóa mềm có hạn lưu theo cấu hình. `trash-retention.sql` thử lên lịch dọn bằng pg_cron; nếu project không có pg_cron, quản trị viên có thể quét thủ công.

Các luồng cần nhiều bảng quan hệ và quy trình chuyên biệt (ví dụ điểm danh theo từng sinh viên/buổi, chấm và phản hồi bài nộp, bảng điểm tính tổng, bình chọn khảo sát, tải tài liệu lên Storage, xuất XLSX, và quản lý tài khoản) chưa hoàn thiện đầy đủ. Các đăng nhập hiện dùng Supabase Auth email/mật khẩu; không dùng tài khoản mặc định hoặc chuyển tài khoản một lần bấm.

## Lệnh

- `npm run dev`: chạy ứng dụng.
- `npm run build`: kiểm tra TypeScript và tạo bản build.
