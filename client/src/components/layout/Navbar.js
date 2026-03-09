import React, { useState, useRef, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { HiShieldCheck, HiMenu, HiX } from 'react-icons/hi';
import { FiSun, FiMoon, FiUser, FiLogOut, FiBarChart2, FiClock } from 'react-icons/fi';
import { logout } from '../../store/slices/authSlice';
import { toggleTheme, closeMobileMenu, toggleMobileMenu } from '../../store/slices/uiSlice';
import './Navbar.css';

const Navbar = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useSelector((state) => state.auth);
  const { theme, mobileMenuOpen } = useSelector((state) => state.ui);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleLogout = () => {
    dispatch(logout());
    setDropdownOpen(false);
    dispatch(closeMobileMenu());
    navigate('/');
  };

  const getInitials = (name) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const navLinks = [
    { to: '/', label: 'Home' },
    { to: '/wall-of-fake', label: 'Wall of Fake' },
    { to: '/about', label: 'About' },
  ];

  const authNavLinks = [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/history', label: 'History' },
  ];

  return (
    <>
      <nav className="navbar">
        <div className="navbar-inner">
          <Link to="/" className="navbar-brand" onClick={() => dispatch(closeMobileMenu())}>
            <div className="navbar-brand-icon">
              <HiShieldCheck />
            </div>
            <span>TASDEEQ</span>
          </Link>

          <div className="navbar-links">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `navbar-link${isActive ? ' active' : ''}`
                }
                end={link.to === '/'}
              >
                {link.label}
              </NavLink>
            ))}
            {isAuthenticated &&
              authNavLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) =>
                    `navbar-link${isActive ? ' active' : ''}`
                  }
                >
                  {link.label}
                </NavLink>
              ))}
          </div>

          <div className="navbar-actions">
            <button
              className="theme-toggle"
              onClick={() => dispatch(toggleTheme())}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <FiSun /> : <FiMoon />}
            </button>

            {isAuthenticated ? (
              <div className="user-menu" ref={dropdownRef}>
                <div
                  className="user-avatar"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                >
                  {getInitials(user?.name)}
                </div>
                {dropdownOpen && (
                  <div className="user-dropdown animate-slideDown">
                    <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {user?.name}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {user?.email}
                      </div>
                    </div>
                    <Link
                      to="/dashboard"
                      className="user-dropdown-item"
                      onClick={() => setDropdownOpen(false)}
                    >
                      <FiBarChart2 /> Dashboard
                    </Link>
                    <Link
                      to="/history"
                      className="user-dropdown-item"
                      onClick={() => setDropdownOpen(false)}
                    >
                      <FiClock /> History
                    </Link>
                    <div className="user-dropdown-divider" />
                    <button className="user-dropdown-item" onClick={handleLogout}>
                      <FiLogOut /> Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost btn-sm">
                  Sign In
                </Link>
                <Link to="/register" className="btn btn-primary btn-sm">
                  Get Started
                </Link>
              </>
            )}

            <button
              className="mobile-menu-btn"
              onClick={() => dispatch(toggleMobileMenu())}
            >
              {mobileMenuOpen ? <HiX /> : <HiMenu />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile nav */}
      <div className={`mobile-nav${mobileMenuOpen ? ' open' : ''}`}>
        {navLinks.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `navbar-link${isActive ? ' active' : ''}`
            }
            end={link.to === '/'}
            onClick={() => dispatch(closeMobileMenu())}
          >
            {link.label}
          </NavLink>
        ))}
        {isAuthenticated &&
          authNavLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `navbar-link${isActive ? ' active' : ''}`
              }
              onClick={() => dispatch(closeMobileMenu())}
            >
              {link.label}
            </NavLink>
          ))}
        {!isAuthenticated && (
          <>
            <Link
              to="/login"
              className="navbar-link"
              onClick={() => dispatch(closeMobileMenu())}
            >
              Sign In
            </Link>
            <Link
              to="/register"
              className="navbar-link"
              onClick={() => dispatch(closeMobileMenu())}
            >
              Get Started
            </Link>
          </>
        )}
      </div>
    </>
  );
};

export default Navbar;
