import { CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight } from "@phosphor-icons/react/ssr";
import styles from "./designExtract.module.css";
export default function LayerPagination({ pagination, review = false }) {
  return <nav className={styles.layerPagination} aria-label={review ? "Review layer pages" : "Layer pages"}>
    <span aria-live="polite">{pagination.total ? pagination.start + 1 : 0}–{pagination.end} of {pagination.total}</span>
    <div><button type="button" aria-label={review ? "Previous review page" : "Previous layer page"} disabled={pagination.page === 0} onClick={pagination.previous}><ChevronLeft size={14} /></button>
      <button type="button" aria-label={review ? "Next review page" : "Next layer page"} disabled={pagination.page >= pagination.pages - 1} onClick={pagination.next}><ChevronRight size={14} /></button></div>
  </nav>;
}
