import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center text-center px-4">
      <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-6">
        <span className="text-2xl font-bold text-muted-foreground">404</span>
      </div>
      <h1 className="text-3xl font-display font-bold text-foreground mb-2">Page Not Found</h1>
      <p className="text-muted-foreground max-w-md mb-8">
        The page you are looking for doesn't exist or has been moved.
      </p>
      <Link href="/">
        <Button>Return Home</Button>
      </Link>
    </div>
  );
}
