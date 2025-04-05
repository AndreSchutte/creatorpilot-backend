const User = require('../models/User');

const requireAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user || !user.isAdmin) {
      return res.status(403).json({ message: 'Access denied. Admins only.' });
    }

    next();
  } catch (error) {
    console.error('Admin check failed:', error);
    res.status(500).json({ message: 'Server error during admin check' });
  }
};

module.exports = requireAdmin;
