import { Box, Milk, Shirt, ShoppingBasket } from 'lucide-react'

// Painel decorativo do login (mock de dashboard), com o roxo da identidade visual (#5b21b6).
export function LoginAnimatedPanel() {
  return (
    <div
      aria-hidden="true"
      className="auth-panel-bg relative h-full w-full overflow-hidden bg-gradient-to-br from-[#1e0b36] via-[#5b21b6] to-[#c4b5fd] p-5 text-white"
    >
      <div className="pointer-events-none absolute -top-10 -left-6 h-36 w-36 rounded-full bg-white/10 blur-2xl auth-float" />
      <div className="pointer-events-none absolute -right-10 top-1/3 h-40 w-40 rounded-full bg-[#c4b5fd]/35 blur-3xl auth-float-delayed" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-32 w-32 rounded-full bg-[#a78bfa]/30 blur-2xl auth-float" />
      <div className="pointer-events-none absolute inset-y-0 -left-1/4 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent auth-sweep" />
      {[10, 28, 43, 62, 81].map((left, idx) => (
        <span
          key={left}
          className="pointer-events-none absolute top-8 h-2 w-2 rounded-full bg-white/45 auth-particle"
          style={{ left: `${left}%`, animationDelay: `${idx * 0.8}s` }}
        />
      ))}

      <div className="relative flex h-full flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: 'R$ 1.2M', delta: '+12.5%' },
            { value: 'R$ 324', delta: '+8.2%' },
            { value: 'R$ 3.8K', delta: '+5.1%' },
          ].map((item) => (
            <div
              key={item.value}
              className="rounded-xl border border-white/20 bg-white/10 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="h-6 w-6 rounded-md bg-white/15" />
                <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold">
                  {item.delta}
                </span>
              </div>
              <p className="text-2xl font-semibold tracking-tight">{item.value}</p>
              <div className="mt-2 h-2 w-20 rounded-full bg-white/15 auth-shimmer" />
            </div>
          ))}
        </div>

        <div className="relative flex-1 overflow-hidden rounded-xl border border-white/20 bg-white/8 p-4">
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.06] to-transparent" />

          <div className="relative grid h-full grid-cols-[2fr_1fr] gap-4">
            <div className="flex h-full min-w-0 flex-col">
              <div className="mb-3 flex items-center justify-between">
                <div className="h-3 w-28 rounded-full bg-white/20 auth-shimmer" />
                <div className="flex gap-4 text-xs text-white/80">
                  <span className="flex items-center gap-2">
                    <i className="h-2 w-2 rounded-full bg-white/90" />
                    Receita
                  </span>
                  <span className="flex items-center gap-2">
                    <i className="h-2 w-2 rounded-full bg-white/60" />
                    Despesas
                  </span>
                </div>
              </div>

              <svg viewBox="0 0 580 220" className="relative h-[150px] w-full">
                <defs>
                  <linearGradient id="area-gradient-login" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.30)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0.04)" />
                  </linearGradient>
                </defs>

                {[40, 80, 120, 160].map((y) => (
                  <line key={y} x1="0" y1={y} x2="580" y2={y} stroke="rgba(255,255,255,0.12)" />
                ))}

                <path
                  d="M0 150 L95 130 L190 92 L285 76 L380 60 L475 46 L580 36 L580 220 L0 220 Z"
                  fill="url(#area-gradient-login)"
                />
                <path
                  d="M0 150 L95 130 L190 92 L285 76 L380 60 L475 46 L580 36"
                  fill="none"
                  stroke="rgba(255,255,255,0.28)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="auth-line-glow"
                />
                <path
                  d="M0 150 L95 130 L190 92 L285 76 L380 60 L475 46 L580 36"
                  fill="none"
                  stroke="rgba(255,255,255,0.95)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="auth-stroke-draw"
                />
                <path
                  d="M0 168 L120 146 L255 122 L350 104 L460 88 L580 74"
                  fill="none"
                  stroke="rgba(255,255,255,0.62)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="auth-stroke-draw delayed"
                />

                {[0, 95, 190, 285, 380, 475, 580].map((x, index) => (
                  <circle
                    key={`dot-a-${x}`}
                    cx={x}
                    cy={[150, 130, 92, 76, 60, 46, 36][index]}
                    r="5"
                    fill="rgba(255,255,255,0.95)"
                    className="auth-dot-pulse"
                    style={{ animationDelay: `${index * 0.2}s` }}
                  />
                ))}
                {[0, 120, 255, 350, 460, 580].map((x, index) => (
                  <circle
                    key={`dot-b-${x}`}
                    cx={x}
                    cy={[168, 146, 122, 104, 88, 74][index]}
                    r="4"
                    fill="rgba(255,255,255,0.72)"
                    className="auth-dot-pulse"
                    style={{ animationDelay: `${index * 0.25 + 0.25}s` }}
                  />
                ))}
              </svg>

              <div className="relative mt-2 grid grid-cols-6 gap-2 text-center text-[11px] text-white/70">
                {['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'].map((month) => (
                  <div key={month} className="space-y-1">
                    <div className="mx-auto h-2 w-10 rounded-full bg-white/18 auth-shimmer" />
                    <p>{month}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/15 bg-white/[0.06] p-3">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/85">
                Ranking de Vendas
              </p>
              <div className="space-y-3">
                {[
                  { loja: 'Loja Física', valor: 'R$ 124k', width: 'w-[88%]' },
                  { loja: 'Nuvemshop', valor: 'R$ 97k', width: 'w-[72%]' },
                  { loja: 'Mercado Livre', valor: 'R$ 81k', width: 'w-[61%]' },
                  { loja: 'Shopee', valor: 'R$ 69k', width: 'w-[52%]' },
                ].map((item, index) => (
                  <div key={item.loja} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-white/85">
                      <span>{item.loja}</span>
                      <span className="font-semibold">{item.valor}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/15">
                      <div
                        className={`h-full rounded-full bg-white/85 auth-rank-grow ${item.width}`}
                        style={{ animationDelay: `${index * 0.25}s` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/20 bg-white/10 p-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/85">
              Vendas por Canal
            </p>
            <div className="h-2 w-20 rounded-full bg-white/18 auth-shimmer" />
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {[
              { icon: Box, produto: 'Kit Barba', vendas: '1.204 un' },
              { icon: Shirt, produto: 'Pomada', vendas: '987 un' },
              { icon: Milk, produto: 'Shampoo', vendas: '846 un' },
              { icon: ShoppingBasket, produto: 'Lâminas', vendas: '692 un' },
            ].map((item) => (
              <div
                key={item.produto}
                className="flex items-center justify-between rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1.5"
              >
                <div className="flex items-center gap-2 text-white/90">
                  <item.icon className="h-3.5 w-3.5" />
                  <span className="truncate">{item.produto}</span>
                </div>
                <span className="font-semibold text-white/95">{item.vendas}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/20 bg-white/10 p-3">
            <div className="mb-4 h-3 w-24 rounded-full bg-white/20 auth-shimmer" />
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-[10px] border-white/80 border-r-white/25 border-b-white/25">
              <span className="text-xl font-bold">85%</span>
            </div>
            <div className="mt-4 flex justify-center gap-4 text-xs text-white/75">
              <span>45%</span>
              <span>30%</span>
              <span>25%</span>
            </div>
          </div>

          <div className="rounded-xl border border-white/20 bg-white/10 p-3">
            <div className="mb-4 h-3 w-24 rounded-full bg-white/20 auth-shimmer" />
            <div className="space-y-3 text-sm">
              {[
                { label: 'Vendas', value: 124, w: 'w-[62%]' },
                { label: 'Despesas', value: 89, w: 'w-[44%]' },
                { label: 'Lucro', value: 156, w: 'w-[78%]' },
              ].map((row) => (
                <div key={row.label}>
                  <div className="mb-1 flex justify-between text-white/85">
                    <span>{row.label}</span>
                    <span className="font-semibold">{row.value}</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/15">
                    <div className={`h-full rounded-full bg-white/80 auth-bar-live ${row.w}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
