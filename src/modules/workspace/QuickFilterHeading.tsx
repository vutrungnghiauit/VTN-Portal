import { Filter, X } from "lucide-react";
import "./quick-filter-heading.css";

type QuickFilterHeadingProps = {
  onClear?: () => void;
  clearDisabled?: boolean;
  subtitle?: string;
};

export default function QuickFilterHeading({ onClear, clearDisabled = false, subtitle = "Lọc nhanh theo thông tin" }: QuickFilterHeadingProps) {
  return <div className="quick-filter-heading">
    <strong><Filter size={16} aria-hidden="true" />Bộ lọc</strong>
    <span>{subtitle}</span>
    {onClear && <button type="button" className="quick-filter-clear-button" disabled={clearDisabled} onClick={onClear}><X size={14} aria-hidden="true" /> Xóa bộ lọc</button>}
  </div>;
}
