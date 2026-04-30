"use client";

import Image from "next/image";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Code2, Cpu, LogOut, Plus, ShieldUser, User as UserIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DashboardHeaderProps {
  user: { name?: string | null; email?: string | null; role?: string | null };
}

export function DashboardHeader({ user }: DashboardHeaderProps) {
  const isAdmin = user.role === "admin";
  const isOperator = user.role === "operator";
  const homeHref = isOperator ? "/operator" : "/dashboard";

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center justify-between px-6">
        <Link
          href={homeHref}
          className="flex items-center gap-2 font-semibold"
        >
          <Image
            src="/logo.png"
            alt="Campus Map logo"
            width={28}
            height={28}
            className="size-7 rounded-md object-contain"
            priority
          />
          <span>Campus Map</span>
        </Link>

        <div className="flex items-center gap-2">
          {isAdmin ? (
            <>
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/iot">
                  <Cpu className="size-4" />
                  IoT
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/users">
                  <ShieldUser className="size-4" />
                  Users
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/programming">
                  <Code2 className="size-4" />
                  Programming
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/editor">
                  <Plus className="size-4" />
                  New map
                </Link>
              </Button>
            </>
          ) : null}
          {isOperator ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/operator">
                <Cpu className="size-4" />
                Operator
              </Link>
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="User menu">
                <UserIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {user.name ?? "Administrator"}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {user.email}
                  </span>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {user.role ?? "admin"}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => signOut({ callbackUrl: "/" })}
                className="cursor-pointer"
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
