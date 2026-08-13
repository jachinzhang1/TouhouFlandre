const SHOUJO_KITOU_GIF =
  "https://media.tenor.com/5StiWpbuWx8AAAAj/%E6%9D%B1%E6%96%B9-%E5%B0%91%E5%A5%B3%E8%AE%80%E5%8F%96%E4%B8%AD.gif";

export default function NotFound() {
  return (
    <section className="relative isolate grid min-h-[calc(100svh-208px)] place-items-center overflow-hidden px-5 max-[680px]:min-h-[calc(100svh-168px)]">
      <div className="relative z-10 flex flex-col items-center text-center">
        <img
          className="h-auto w-[clamp(120px,12vw,168px)] [image-rendering:pixelated]"
          src={SHOUJO_KITOU_GIF}
          alt="少女祈祷中动画"
          width={121}
          height={108}
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
        />
        <h1 className="mt-7 font-brand text-[clamp(2rem,4vw,3.25rem)] font-bold leading-none text-ink">
          页面不存在
        </h1>
        <p className="mt-4 text-sm tracking-[0.08em] text-ink-soft">
          少女祈祷中……
        </p>
      </div>
      <span
        className="not-found-code pointer-events-none absolute inset-x-0 bottom-[-0.08em] -z-10 select-none text-center font-brand font-black"
        aria-hidden="true"
      >
        404
      </span>
    </section>
  );
}
