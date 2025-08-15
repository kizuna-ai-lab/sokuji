/**
 * Sign-in page component using Clerk's built-in SignIn component
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { SignIn as ClerkSignIn, isExtensionEnvironment } from '../lib/clerk/ClerkProvider';
import '../components/Auth/SignInPage.scss';

export function SignIn() {
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
        <ClerkSignIn 
          routing="virtual" 
          oauthFlow={isExtensionEnvironment ? 'popup' : 'redirect'}
        />
      </div>
    </div>
  );
}