"use client";
import { useEffect } from "react";
import Link from "next/link";
import { UserRound } from "lucide-react";
import { useData } from "./ui";
export function ProfileLink() {
  const { data, reload } = useData<{ displayName: string }>("/api/profile");
  useEffect(() => {
    const refresh = () => {
      void reload();
    };
    window.addEventListener("profile-updated", refresh);
    return () => window.removeEventListener("profile-updated", refresh);
  }, [reload]);
  return (
    <Link className="nav-link profile-link" href="/profile">
      <UserRound size={17} />
      <span>
        {data?.displayName || "Your profile"}
        <small>Profile & display name</small>
      </span>
    </Link>
  );
}
