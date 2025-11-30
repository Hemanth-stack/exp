import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, BrainCircuit, Code, Zap } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur-sm">
        <div className="container flex h-14 items-center">
          <Link href="/" className="flex items-center space-x-2">
            <BrainCircuit className="h-6 w-6 text-primary" />
            <span className="font-bold">AI App Builder</span>
          </Link>
          <div className="flex flex-1 items-center justify-end space-x-4">
            <nav className="flex items-center space-x-2">
              <Link href="/login">
                <Button variant="ghost">Login</Button>
              </Link>
              <Link href="/register">
                <Button>
                  Get Started <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="py-24 px-4 text-center">
          <div className="container">
            <h1 className="text-5xl font-extrabold tracking-tight mb-4">
              Build & Deploy AI Apps with Ease
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
              An open-source platform to create, deploy, and manage AI-powered applications.
              From idea to production in minutes.
            </p>
            <div className="flex justify-center space-x-4">
              <Link href="/register">
                <Button size="lg">
                  Start Building for Free
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/mastra-demo">
                <Button size="lg" variant="outline">
                  Live Demo
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="py-24 px-4 bg-muted/40">
          <div className="container">
            <h2 className="text-4xl font-bold text-center mb-12">How It Works</h2>
            <div className="grid md:grid-cols-3 gap-8 text-center">
              <div className="flex flex-col items-center">
                <div className="p-4 bg-primary/10 rounded-full mb-4">
                  <Code className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">1. Describe Your App</h3>
                <p className="text-muted-foreground">
                  Use natural language to describe the application you want to build.
                </p>
              </div>
              <div className="flex flex-col items-center">
                <div className="p-4 bg-primary/10 rounded-full mb-4">
                  <BrainCircuit className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">2. AI Generates Code</h3>
                <p className="text-muted-foreground">
                  Our AI agents generate the code, components, and infrastructure for you.
                </p>
              </div>
              <div className="flex flex-col items-center">
                <div className="p-4 bg-primary/10 rounded-full mb-4">
                  <Zap className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">3. Deploy Instantly</h3>
                <p className="text-muted-foreground">
                  Deploy your app to a secure, scalable sandbox environment with one click.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-6">
        <div className="container text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} AI App Builder. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
