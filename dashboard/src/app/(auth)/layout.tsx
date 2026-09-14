import { ReactNode } from 'react'

export default function AuthGroupLayout({ children }: { children: ReactNode }) {
  return <div className="auth-light">{children}</div>
}
