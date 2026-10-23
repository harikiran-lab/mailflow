import FlowIcon from './FlowIcon.jsx';
export default function FlowCharm({paused=false}) {return <span className={'flow-charm'+(paused?' flow-charm-paused':'')} aria-hidden="true"><FlowIcon size={19}/></span>;}
