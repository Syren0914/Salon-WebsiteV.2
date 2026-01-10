import React, { useEffect, useRef, useState } from 'react';

interface RevealProps {
  children: React.ReactNode;
  width?: "fit-content" | "100%";
  delay?: number;
  className?: string;
}

const Reveal: React.FC<RevealProps> = ({ children, width = "100%", delay = 0, className = "" }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        if (ref.current) observer.unobserve(ref.current);
      }
    }, { threshold: 0.1, rootMargin: "0px 0px -50px 0px" });

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (ref.current) try { observer.unobserve(ref.current); } catch(e){}
    };
  }, []);

  return (
    <div ref={ref} style={{ width }} className={className}>
      <div
        style={{ transitionDelay: `${delay}s` }}
        className={`transition-all duration-700 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] transform ${
          isVisible ? "opacity-100 translate-y-0 filter blur-0" : "opacity-0 translate-y-12 filter blur-[2px]"
        }`}
      >
        {children}
      </div>
    </div>
  );
};

export default Reveal;