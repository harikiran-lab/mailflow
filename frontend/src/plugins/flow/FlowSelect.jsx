import { useEffect,useId,useRef,useState } from 'react';

export default function FlowSelect({label,value,options,onChange,disabled=false}) {
  const id=useId(),root=useRef(null),trigger=useRef(null),[open,setOpen]=useState(false),[active,setActive]=useState(0);
  const selected=options.find(o=>o.value===value)||options[0];
  useEffect(()=>{const close=e=>{if(!root.current?.contains(e.target))setOpen(false);};document.addEventListener('pointerdown',close);return ()=>document.removeEventListener('pointerdown',close);},[]);
  useEffect(()=>{if(open)document.getElementById(`${id}-${active}`)?.scrollIntoView?.({block:'nearest'});},[open,active,id]);
  const choose=option=>{onChange(option.value);setOpen(false);trigger.current?.focus();};
  const reveal=()=>{setActive(Math.max(0,options.findIndex(o=>o.value===value)));setOpen(true);};
  return <div className="flow-select" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
    <button type="button" ref={trigger} role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-activedescendant={open?`${id}-${active}`:undefined} disabled={disabled} onClick={()=>open?setOpen(false):reveal()} onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);}
      else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();if(!open)reveal();else setActive(i=>e.key==='Home'?0:e.key==='End'?options.length-1:(i+(e.key==='ArrowDown'?1:-1)+options.length)%options.length);}
      else if(open&&['Enter',' '].includes(e.key)){e.preventDefault();choose(options[active]);}
    }}><span className="flow-select-avatar" aria-hidden="true">{value?'@':'✦'}</span><span>{selected?.label}</span><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg></button>
    {open&&<div className="flow-select-menu" role="listbox" id={id} aria-label={label}>{options.map((option,index)=><div id={`${id}-${index}`} role="option" aria-selected={option.value===value} className={index===active?'flow-select-highlight':''} key={option.value} onPointerDown={e=>e.preventDefault()} onMouseMove={()=>setActive(index)} onClick={()=>choose(option)}><span><strong>{option.label}</strong>{option.detail&&<small>{option.detail}</small>}</span>{option.value===value&&<span aria-hidden="true">✓</span>}</div>)}</div>}
  </div>;
}
