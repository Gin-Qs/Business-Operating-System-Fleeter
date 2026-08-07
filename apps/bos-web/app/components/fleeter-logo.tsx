type FleeterLogoVariant = "core" | "evolution";

interface FleeterLogoProps {
  className?: string;
  priority?: boolean;
  variant?: FleeterLogoVariant;
}

const logoSource: Record<FleeterLogoVariant, string> = {
  core: "/brand/fleeter-core-flat-color.svg",
  evolution: "/brand/fleeter-core-evolution-dark.png",
};

/** Approved Fleeter signatures. The Core signature is for navigation; Evolution is for high-impact use. */
export function FleeterLogo({ className = "", priority = false, variant = "core" }: FleeterLogoProps) {
  return (
    <img
      alt="Fleeter"
      className={`block h-auto ${className}`}
      decoding={priority ? "sync" : "async"}
      fetchPriority={priority ? "high" : "auto"}
      src={logoSource[variant]}
    />
  );
}
