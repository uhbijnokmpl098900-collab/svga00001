// Global Version Configuration and Enforcement Utilities

export const CURRENT_APP_VERSION = 'v3.0.0';
export const DEFAULT_ALLOWED_VERSION = 'v3.0.0';

export const COMMON_VERSION_PRESETS = [
  'v3.0.0',
  'v2.5.0',
  'v2.4.0',
  'v2.0.0',
  'v1.8.0',
  'v1.0.0'
];

/**
 * Get active client version (supports simulation mode for admin testing)
 */
export const getActiveClientVersion = (): string => {
  const simulated = localStorage.getItem('simulated_client_version');
  if (simulated && simulated.trim()) {
    return simulated.trim();
  }
  return CURRENT_APP_VERSION;
};

/**
 * Set or clear simulated client version for testing
 */
export const setSimulatedClientVersion = (version: string | null) => {
  if (version && version.trim() && version !== CURRENT_APP_VERSION) {
    localStorage.setItem('simulated_client_version', version.trim());
  } else {
    localStorage.removeItem('simulated_client_version');
  }
};

/**
 * Checks if the account's allowed version matches the active client version.
 * If user has no specific allowedVersion, falls back to default allowed version.
 */
export const checkVersionCompatibility = (
  userAllowedVersion?: string | null,
  clientVersion?: string
): { isAllowed: boolean; requiredVersion: string; currentVersion: string } => {
  const activeClient = clientVersion || getActiveClientVersion();
  const required = (userAllowedVersion && userAllowedVersion.trim()) 
    ? userAllowedVersion.trim() 
    : DEFAULT_ALLOWED_VERSION;

  const isAllowed = activeClient.toLowerCase() === required.toLowerCase();

  return {
    isAllowed,
    requiredVersion: required,
    currentVersion: activeClient
  };
};

/**
 * Server-side verification request
 */
export const verifyAccountVersionWithServer = async (
  userId: string,
  userEmail?: string,
  userAllowedVersion?: string
): Promise<{
  allowed: boolean;
  requiredVersion: string;
  installedVersion: string;
  message?: string;
}> => {
  const currentClient = getActiveClientVersion();
  try {
    const res = await fetch('/api/version/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-version': currentClient,
        'x-user-id': userId,
        'x-user-email': userEmail || '',
        'x-user-allowed-version': userAllowedVersion || ''
      },
      body: JSON.stringify({
        userId,
        email: userEmail,
        allowedVersion: userAllowedVersion,
        clientVersion: currentClient
      })
    });

    const data = await res.json();
    return {
      allowed: data.allowed ?? true,
      requiredVersion: data.requiredVersion || userAllowedVersion || DEFAULT_ALLOWED_VERSION,
      installedVersion: data.installedVersion || currentClient,
      message: data.message
    };
  } catch (error) {
    // Local fallback check if network error
    const localCheck = checkVersionCompatibility(userAllowedVersion, currentClient);
    return {
      allowed: localCheck.isAllowed,
      requiredVersion: localCheck.requiredVersion,
      installedVersion: localCheck.currentVersion
    };
  }
};
