'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Save, User, CreditCard, Shield, BrainCircuit, LogOut, Settings } from 'lucide-react';

function Sidebar({ user }: { user: any }) {
  return (
    <aside className="w-64 flex-shrink-0 border-r bg-background flex flex-col">
      <div className="p-4 border-b">
        <Link href="/dashboard" className="flex items-center space-x-2">
          <BrainCircuit className="h-8 w-8 text-primary" />
          <span className="text-xl font-bold">AI App Builder</span>
        </Link>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        <Link href="/dashboard" className="flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted">
          <span>My Projects</span>
        </Link>
        <Link href="/settings" className="flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium bg-muted">
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </Link>
      </nav>
      <div className="p-4 border-t">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-bold">
            {user?.name?.[0].toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="font-semibold">{user?.name}</div>
            <div className="text-xs text-muted-foreground">{user?.email}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => {}}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}

function SettingsCard({ title, description, children, footer }: { title: string, description: string, children: React.ReactNode, footer: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {children}
      </CardContent>
      <CardContent className="border-t pt-6">
        {footer}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);
  
  const [name, setName] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
    if (session?.user) {
      setName(session.user.name || '');
    }
  }, [status, router, session]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProfileLoading(true);
    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (response.ok) {
        await update({ name });
        toast({
          title: 'Profile Updated',
          description: 'Your name has been updated successfully.',
        });
      } else {
        throw new Error('Failed to update profile');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update profile. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsProfileLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm('Are you sure you want to delete your account? This action is permanent and cannot be undone.')) {
      return;
    }

    setIsDeleteLoading(true);
    try {
      const response = await fetch('/api/auth/account', {
        method: 'DELETE',
      });

      if (response.ok) {
        router.push('/?account_deleted=true');
      } else {
        throw new Error('Failed to delete account');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete account. Please try again.',
        variant: 'destructive',
      });
      setIsDeleteLoading(false);
    }
  };

  if (status === 'loading' || !session) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-muted/40">
      <Sidebar user={session.user} />
      <main className="flex-1 overflow-y-auto">
        <header className="border-b bg-background">
          <div className="container mx-auto px-6 py-4">
            <h1 className="text-2xl font-bold">Settings</h1>
          </div>
        </header>
        <div className="p-6 space-y-6">
          <SettingsCard
            title="Profile"
            description="This is how others will see you on the site."
            footer={
              <div className="flex justify-end">
                <Button onClick={handleSaveProfile} disabled={isProfileLoading}>
                  {isProfileLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </div>
            }
          >
            <form className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={session.user?.email || ''} disabled />
                <p className="text-xs text-muted-foreground">
                  Your email address is used for login and cannot be changed.
                </p>
              </div>
            </form>
          </SettingsCard>

          <SettingsCard
            title="Delete Account"
            description="Permanently delete your account and all of your projects. This action is not reversible."
            footer={
              <div className="flex justify-end">
                <Button variant="destructive" onClick={handleDeleteAccount} disabled={isDeleteLoading}>
                  {isDeleteLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Delete My Account
                </Button>
              </div>
            }
          >
            <p className="text-sm text-muted-foreground">
              Make sure you have saved any important information before deleting your account.
            </p>
          </SettingsCard>
        </div>
      </main>
    </div>
  );
}
