"use client"

import * as React from "react"
import { useState } from "react"
import { LayoutDashboard, ArrowRight, Menu, X } from "lucide-react"
import { Button } from "./Button"
import { cn } from "../utils"

export interface MarketingHeaderProps {
  brandingName?: string
  brandingLogo?: string | null
  user?: any
  activeSubdomain?: string
  scrolled?: boolean
  onLoginClick?: () => void
  onDashboardClick?: () => void
  onLogoClick?: () => void
}

export function MarketingHeader({
  brandingName = "180workspace",
  brandingLogo,
  user,
  scrolled = false,
  onLoginClick,
  onDashboardClick,
  onLogoClick
}: MarketingHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleLogoClick = () => {
    if (onLogoClick) onLogoClick()
    else window.scrollTo({ top: 0, behavior: "smooth" })
    setMobileMenuOpen(false)
  }

  return (
    <nav className={cn(
      "fixed top-0 w-full z-50 transition-all duration-300",
      scrolled ? "glass py-4 shadow-sm" : "bg-transparent py-6"
    )}>
      <div className="max-w-7xl mx-auto px-4 md:px-6 flex items-center justify-between">
        {/* Logo Section */}
        <div className="flex items-center gap-3 group cursor-pointer" onClick={handleLogoClick}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
            {brandingLogo ? (
              <img src={brandingLogo} alt={brandingName} className="w-6 h-6 object-contain" />
            ) : (
              <span className="text-white font-bold text-xl">{brandingName?.[0] || 'I'}</span>
            )}
          </div>
          <span className="text-xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400">
            {brandingName}
          </span>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-gray-500 dark:text-gray-400">
          <a href="#features" className="hover:text-primary dark:hover:text-white transition-colors">Features</a>
          <a href="#about" className="hover:text-primary dark:hover:text-white transition-colors">About</a>
          <a href="#contact" className="hover:text-primary dark:hover:text-white transition-colors">Contact</a>
        </div>

        {/* Desktop Actions */}
        <div className="hidden md:flex items-center gap-4">
          {user ? (
            <Button variant="default" className="bg-primary hover:bg-primary-dark text-white font-bold shadow-lg shadow-primary/20" onClick={onDashboardClick}>
              Go to Dashboard
              <LayoutDashboard className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button variant="default" className="bg-primary hover:bg-primary-dark text-white font-bold shadow-lg shadow-primary/20" onClick={onLoginClick}>
              Sign In to Portal
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <div className="md:hidden flex items-center">
          <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </Button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="absolute top-full left-0 w-full glass border-t border-white/20 dark:border-white/10 p-4 flex flex-col gap-4 md:hidden shadow-xl animate-in slide-in-from-top-2">
          <div className="flex flex-col gap-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
            <a href="#features" onClick={() => setMobileMenuOpen(false)} className="p-2 hover:bg-white/50 dark:hover:bg-black/50 rounded-lg transition-colors">Features</a>
            <a href="#about" onClick={() => setMobileMenuOpen(false)} className="p-2 hover:bg-white/50 dark:hover:bg-black/50 rounded-lg transition-colors">About</a>
            <a href="#contact" onClick={() => setMobileMenuOpen(false)} className="p-2 hover:bg-white/50 dark:hover:bg-black/50 rounded-lg transition-colors">Contact</a>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
            {user ? (
              <Button variant="default" className="w-full bg-primary hover:bg-primary-dark text-white font-bold" onClick={() => { setMobileMenuOpen(false); if(onDashboardClick) onDashboardClick(); }}>
                Go to Dashboard
                <LayoutDashboard className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button variant="default" className="w-full bg-primary hover:bg-primary-dark text-white font-bold" onClick={() => { setMobileMenuOpen(false); if(onLoginClick) onLoginClick(); }}>
                Sign In to Portal
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
