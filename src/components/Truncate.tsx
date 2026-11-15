import { useEffect, useRef, useState } from "react";

interface Props {
  text: string;
  className?: string;
}

/**
 * 单行文本：放不下时右侧渐变淡出，悬停显示完整内容。
 * 只有真正溢出时才启用渐变与浮层，短文本不受影响。
 */
export default function Truncate({ text, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const check = () => {
      setOverflow(element.scrollWidth > element.clientWidth + 1);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span
      className={`truncate ${overflow ? "is-truncated" : ""} ${className ?? ""}`}
      data-full={text}
    >
      <span ref={ref}>{text}</span>
    </span>
  );
}
