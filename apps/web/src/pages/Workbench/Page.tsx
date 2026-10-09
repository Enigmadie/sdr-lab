import type { ReactElement } from 'react';
import { useWorkbenchPage } from './model/use-workbench-page';
import WorkbenchView from './ui/WorkbenchView';

export default function WorkbenchPage(): ReactElement {
  return <WorkbenchView {...useWorkbenchPage()} />;
}
