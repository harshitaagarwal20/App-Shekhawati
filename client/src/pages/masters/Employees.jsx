import MasterPage from './MasterPage.jsx';
import { employeeMaster } from '../../config/masters.jsx';

export default function Employees() {
  return <MasterPage descriptor={employeeMaster} />;
}
