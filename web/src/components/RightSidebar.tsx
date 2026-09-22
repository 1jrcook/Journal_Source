import SheetBoard from './SheetBoard';

/** Journal's right side is the spreadsheet. The old outline / backlinks rail is not used. */
export default function RightSidebar() {
  return (
    <div className="right-sidebar">
      <SheetBoard />
    </div>
  );
}
