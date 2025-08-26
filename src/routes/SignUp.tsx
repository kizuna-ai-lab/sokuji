/**
 * Sign-up page component using Clerk's built-in SignUp component
 */

import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { SignUp as ClerkSignUp, isExtensionEnvironment } from '../lib/clerk/ClerkProvider';
import '../components/Auth/SignInPage.scss'; // Reuse the same styles

export function SignUp() {
  const navigate = useNavigate();

  const handleBackClick = () => {
    // Navigate back to home
    navigate('/');
  };

  return (
    <div className="sign-in-page">
      <button className="back-button" onClick={handleBackClick}>
        <ArrowLeft size={20} />
        <span>Back to App</span>
      </button>
      
      <div className="sign-in-container">
        <ClerkSignUp 
          routing="virtual" 
          oauthFlow={isExtensionEnvironment ? 'popup' : 'redirect'}
          oidcPrompt="select_account"
        />
      </div>
    </div>
  );
}